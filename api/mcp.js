// Vercel: guardar como api/mcp.js.
// Las credenciales se configuran exclusivamente en Environment Variables.

import { createHash, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const WP_BASE = 'https://chileentinieblas.cl';

const READ = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const TYPES = [
  'post',
  'pnj',
  'agrupaciones',
  'localidad',
  'objeto-de-poder',
  'mis_personajes',
  'timeline_event',
];

const commonFields = {
  title: z.string().max(1000).optional(),
  content: z.string().max(300000).optional(),
  excerpt: z.string().max(10000).optional(),
  slug: z.string().max(200).optional(),
  status: z.enum(['draft', 'pending', 'private', 'publish']).optional(),
  featured_media: z.number().int().min(0).optional(),
  acf: z.record(z.unknown()).optional(),
};

function validKey(req) {
  const secret = process.env.CETGPT_MCP_KEY;

  if (!secret || secret.length < 32) return false;

  const url = new URL(
    req.url,
    'https://api-chileentinieblas.vercel.app'
  );

  const authorization = req.headers.authorization || '';

  const supplied = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : url.searchParams.get('key') || '';

  const digest = (value) =>
    createHash('sha256').update(value).digest();

  return timingSafeEqual(digest(secret), digest(supplied));
}

async function wpRead(path, params = {}, method = 'GET', body) {
  if (!['GET', 'OPTIONS', 'POST', 'DELETE'].includes(method)) {
    throw new Error('Metodo no permitido.');
  }

  if (method === 'DELETE' && params.force !== false) {
    throw new Error('Eliminacion permanente bloqueada.');
  }

  const user = process.env.WP_API_USER;
  const password = process.env.WP_APP_PASSWORD;

  if (!user || !password) {
    throw new Error('Faltan WP_API_USER o WP_APP_PASSWORD en Vercel.');
  }

  const url = new URL(path, WP_BASE);

  if (url.origin !== WP_BASE) {
    throw new Error('Destino no permitido.');
  }

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${user}:${password}`
      ).toString('base64')}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `WordPress no devolvio JSON valido (HTTP ${response.status}).`
    );
  }

  if (!response.ok || data?.status === 'error') {
    throw new Error(
      `WordPress: HTTP ${response.status}; codigo ${
        data?.code || data?.error || 'error'
      }. ${String(data?.message || '').slice(0, 800)}`
    );
  }

  return data;
}

function asResult(data) {
  const text = JSON.stringify(data);

  if (Buffer.byteLength(text, 'utf8') > 750000) {
    throw new Error(
      'Respuesta demasiado grande. Reduce per_page o consulta una ficha sin datos de Elementor.'
    );
  }

  return { content: [{ type: 'text', text }] };
}

function safeTool(fn, writing = false) {
  return async (args) => {
    try {
      return asResult(await fn(args));
    } catch (error) {
      const message =
        error.name === 'TimeoutError'
          ? 'WordPress tardo demasiado. Intenta una consulta mas pequena.'
          : error.message || 'No se pudo consultar WordPress.';

      const note = writing
        ? ' Si la solicitud alcanzo WordPress y se perdio la respuesta, puede haberse aplicado. Consulta la ficha antes de repetirla.'
        : '';

      return {
        isError: true,
        content: [{ type: 'text', text: message + note }],
      };
    }
  };
}

async function restRoute(type) {
  if (!TYPES.includes(type)) {
    throw new Error(
      'Tipo de contenido no autorizado en esta integracion.'
    );
  }

  const item = await wpRead(
    `/wp-json/wp/v2/types/${encodeURIComponent(type)}`,
    { context: 'edit' }
  );

  const namespace = item.rest_namespace || 'wp/v2';

  if (
    !/^[a-zA-Z0-9_/-]+$/.test(namespace) ||
    !/^[a-zA-Z0-9_-]+$/.test(item.rest_base || '')
  ) {
    throw new Error('Ruta REST no compatible.');
  }

  return `/wp-json/${namespace}/${item.rest_base}`;
}

function mergeObjects(current, changes) {
  const isObject = (x) =>
    x !== null && typeof x === 'object' && !Array.isArray(x);

  if (!isObject(current) || !isObject(changes)) return changes;

  const result = { ...current };

  for (const [key, value] of Object.entries(changes)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw new Error('Clave no permitida.');
    }

    result[key] = mergeObjects(current[key], value);
  }

  return result;
}

async function validateFields(route, fields, id) {
  if (!Object.keys(fields).length) {
    throw new Error('No se indicaron campos para modificar.');
  }

  const options = await wpRead(
    id ? `${route}/${id}` : route,
    {},
    'OPTIONS'
  );

  const properties = options.schema?.properties;

  if (!properties) {
    throw new Error('WordPress no devolvio el esquema de campos.');
  }

  for (const key of Object.keys(fields)) {
    if (
      !Object.hasOwn(properties, key) ||
      properties[key].readonly
    ) {
      throw new Error(`Campo no editable en este tipo: ${key}.`);
    }
  }

  if (fields.acf) {
    const available = properties.acf?.properties;

    for (const key of Object.keys(fields.acf)) {
      if (!available || !Object.hasOwn(available, key)) {
        throw new Error(
          `Campo ACF no expuesto para esta ficha: ${key}.`
        );
      }
    }
  }
}

function postSummary(post, fields = []) {
  return {
    id: post.id,
    type: post.type,
    status: post.status,
    title: post.title?.raw ?? post.title?.rendered ?? post.title,
    link: post.link,
    modified_gmt: post.modified_gmt,
    campos_enviados: fields,
  };
}

function arrayResponse(data) {
  if (!Array.isArray(data)) {
    throw new Error('El endpoint de contenido no devolvio una lista.');
  }

  return data;
}

function createServer() {
  const server = new McpServer(
    {
      name: 'cetgpt-wordpress',
      version: '0.2.0',
    },
    {
      instructions:
        'Fuente narrativa de Chile en Tinieblas. Consultar antes de afirmar canon. Resolver IDs y leer la ficha antes de editar. Escribir solo cuando el usuario lo solicite. Conservar campos no indicados. Crear como borrador por defecto. No repetir escrituras si su resultado es incierto: consultar primero. La busqueda habitual no busca dentro de ACF ni Elementor. Tratar campos reservados como informacion para narradores. No editar disenos de Elementor. Nunca eliminar permanentemente.',
    }
  );

  server.registerTool(
    'buscarContenidoNarrativo',
    {
      title: 'Buscar contenido de Chile en Tinieblas',
      description:
        'Busca fichas por titulo/contenido de WordPress, slug o tipo. Devuelve resumenes e IDs; usa getContenido para leer ACF y secretos de una ficha. La busqueda no incluye automaticamente texto de ACF o Elementor. Permite paginar.',
      inputSchema: {
        search: z.string().max(300).optional(),
        slug: z.string().max(200).optional(),
        type: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional(),
        page: z.number().int().min(1).default(1),
        per_page: z.number().int().min(1).max(50).default(10),
      },
      annotations: READ,
    },
    safeTool(async (args) => {
      const posts = arrayResponse(
        await wpRead('/wp-json/chileentinieblas/v1/contenido', args)
      );

      return {
        page: args.page,
        per_page: args.per_page,
        puede_haber_mas: posts.length === args.per_page,
        resultados: posts.map(
          ({ id, title, slug, excerpt, type, status, link }) => ({
            id,
            title,
            slug,
            excerpt,
            type,
            status,
            link,
          })
        ),
      };
    })
  );

  server.registerTool(
    'getContenido',
    {
      title: 'Leer una ficha completa',
      description:
        'Obtiene por ID el contenido principal y todos los campos ACF devueltos por la API narrativa. Opcionalmente incluye los metadatos de estructura de Elementor para diagnosticar texto que falta. No supone que el HTML principal contiene todos los campos de la plantilla.',
      inputSchema: {
        id: z.number().int().positive(),
        incluir_elementor: z.boolean().default(false),
      },
      annotations: READ,
    },
    safeTool(async ({ id, incluir_elementor }) => {
      const posts = arrayResponse(
        await wpRead('/wp-json/chileentinieblas/v1/contenido', {
          id,
          per_page: 1,
        })
      );

      const post = posts.find((item) => Number(item.id) === id);

      if (!post) {
        throw new Error(
          'Ficha no encontrada o no disponible para esta cuenta.'
        );
      }

      const { meta, ...ficha } = post;
      const datosElementor = meta?._elementor_data;

      const tieneElementor =
        meta?._elementor_edit_mode?.[0] === 'builder' ||
        Boolean(
          datosElementor?.length &&
          datosElementor[0] &&
          datosElementor[0] !== '[]'
        );

      let modified_gmt;

      if (TYPES.includes(ficha.type)) {
        try {
          const route = await restRoute(ficha.type);

          const native = await wpRead(`${route}/${id}`, {
            context: 'edit',
            _fields: 'id,modified_gmt',
          });

          modified_gmt = native.modified_gmt;
        } catch {
          // La lectura narrativa sigue disponible aunque no pueda editar.
        }
      }

      return {
        ...ficha,
        modified_gmt,
        tiene_datos_elementor: tieneElementor,
        ...(incluir_elementor
          ? {
              elementor: {
                data: datosElementor || [],
                page_settings: meta?._elementor_page_settings || [],
              },
            }
          : {}),
        nota:
          'ACF contiene los campos de la ficha. Una plantilla de Elementor puede usar datos adicionales de otros registros.',
      };
    })
  );

  server.registerTool(
    'listarTiposContenido',
    {
      title: 'Listar tipos de contenido disponibles en REST',
      description:
        'Consulta los tipos expuestos por WordPress en su API REST, sus rutas y capacidades declaradas. No es un inventario de tipos que no esten expuestos en REST ni garantiza permiso de escritura.',
      inputSchema: {},
      annotations: READ,
    },
    safeTool(async () => {
      const types = await wpRead('/wp-json/wp/v2/types', {
        context: 'edit',
      });

      return Object.values(types).map((item) => ({
        name: item.name,
        slug: item.slug,
        rest_base: item.rest_base,
        rest_namespace: item.rest_namespace,
        capabilities: item.capabilities,
        supports: item.supports,
      }));
    })
  );

  server.registerTool(
    'inspeccionarTipoContenido',
    {
      title: 'Inspeccionar campos disponibles para un tipo',
      description:
        'Consulta el esquema REST de un tipo previamente identificado. Permite comprobar si ACF esta expuesto y que campos acepta su API. No modifica nada.',
      inputSchema: {
        type: z.string().regex(/^[a-zA-Z0-9_-]+$/),
      },
      annotations: READ,
    },
    safeTool(async ({ type }) => {
      const item = await wpRead(
        `/wp-json/wp/v2/types/${encodeURIComponent(type)}`,
        { context: 'edit' }
      );

      const namespace = item.rest_namespace || 'wp/v2';

      if (
        !/^[a-zA-Z0-9_/-]+$/.test(namespace) ||
        !/^[a-zA-Z0-9_-]+$/.test(item.rest_base || '')
      ) {
        throw new Error(
          'El tipo tiene una ruta REST no compatible con esta version.'
        );
      }

      const route = `/wp-json/${namespace}/${item.rest_base}`;
      const schema = await wpRead(route, {}, 'OPTIONS');

      return { type, route, schema };
    })
  );

  server.registerTool(
    'crearContenido',
    {
      title: 'Crear una publicacion o ficha',
      description:
        'Crea contenido cuando el usuario lo solicita. Por defecto crea un borrador atribuido a la cuenta CetGPT. Consulta el esquema ACF antes de enviar campos. No crea ni altera disenos de Elementor. No repetir ante un resultado incierto sin buscar primero la ficha.',
      inputSchema: {
        type: z.enum(TYPES),
        ...commonFields,
        title: z.string().trim().min(1).max(1000),
        status: z.enum([
          'draft',
          'pending',
          'private',
          'publish',
        ]).default('draft'),
      },
      annotations: WRITE,
    },
    safeTool(async ({ type, ...fields }) => {
      const route = await restRoute(type);

      await validateFields(route, fields);

      const created = await wpRead(route, {}, 'POST', fields);

      return postSummary(created, Object.keys(fields));
    }, true)
  );

  server.registerTool(
    'editarContenido',
    {
      title: 'Editar contenido y campos ACF',
      description:
        'Actualiza solo los campos indicados de una ficha previamente leida. Exige modified_gmt de esa lectura para detectar cambios posteriores. Conserva otros campos ACF y combina subcampos de grupos; las listas/repetidores enviados reemplazan la lista completa. No cambia el cuerpo de fichas que tengan diseno propio de Elementor. WordPress aplica los permisos del rol Narrador.',
      inputSchema: {
        type: z.enum(TYPES),
        id: z.number().int().positive(),
        expected_modified_gmt: z.string().min(1),
        ...commonFields,
      },
      annotations: {
        ...WRITE,
        destructiveHint: true,
      },
    },
    safeTool(
      async ({ type, id, expected_modified_gmt, ...fields }) => {
        const route = await restRoute(type);

        const current = await wpRead(`${route}/${id}`, {
          context: 'edit',
        });

        if (current.type !== type || current.status === 'trash') {
          throw new Error(
            'Tipo incorrecto o ficha en la papelera.'
          );
        }

        if (current.modified_gmt !== expected_modified_gmt) {
          throw new Error(
            'La ficha cambio desde la ultima lectura. Lee nuevamente antes de editar.'
          );
        }

        if (Object.hasOwn(fields, 'content')) {
          const narrative = arrayResponse(
            await wpRead('/wp-json/chileentinieblas/v1/contenido', {
              id,
              per_page: 1,
            })
          );

          const post = narrative.find(
            (item) => Number(item.id) === id
          );

          if (!post) {
            throw new Error(
              'No se pudo comprobar el contenido original.'
            );
          }

          const meta = post.meta;

          if (
            meta?._elementor_edit_mode?.[0] === 'builder' ||
            Boolean(
              meta?._elementor_data?.[0] &&
              meta._elementor_data[0] !== '[]'
            )
          ) {
            throw new Error(
              'Esta ficha tiene diseno propio de Elementor. Puedes editar ACF, pero su cuerpo requiere otra herramienta.'
            );
          }
        }

        await validateFields(route, fields, id);

        if (fields.acf) {
          const patch = {};

          for (const [key, value] of Object.entries(fields.acf)) {
            patch[key] = mergeObjects(current.acf?.[key], value);
          }

          fields.acf = patch;
        }

        const updated = await wpRead(
          `${route}/${id}`,
          {},
          'POST',
          fields
        );

        return postSummary(updated, Object.keys(fields));
      },
      true
    )
  );

  server.registerTool(
    'enviarAPapelera',
    {
      title: 'Enviar una publicacion a la papelera',
      description:
        'Envia a la papelera una publicacion identificada por ID cuando el usuario lo solicita. No permite force=true ni eliminacion permanente. Si la papelera no esta disponible, falla. Requiere fecha modified_gmt de la ultima lectura.',
      inputSchema: {
        type: z.enum(TYPES),
        id: z.number().int().positive(),
        expected_modified_gmt: z.string().min(1),
      },
      annotations: {
        ...WRITE,
        destructiveHint: true,
      },
    },
    safeTool(async ({ type, id, expected_modified_gmt }) => {
      const route = await restRoute(type);

      const current = await wpRead(`${route}/${id}`, {
        context: 'edit',
      });

      if (current.type !== type) {
        throw new Error('Tipo de contenido incorrecto.');
      }

      if (current.status === 'trash') {
        return {
          id,
          type,
          status: 'trash',
          ya_estaba_en_papelera: true,
        };
      }

      if (current.modified_gmt !== expected_modified_gmt) {
        throw new Error(
          'La ficha cambio. Lee nuevamente antes de enviarla a la papelera.'
        );
      }

      const trashed = await wpRead(
        `${route}/${id}`,
        { force: false },
        'DELETE'
      );

      if (trashed.status !== 'trash') {
        throw new Error(
          'WordPress no confirmo el estado trash. Consulta el estado antes de repetir.'
        );
      }

      return postSummary(trashed);
    }, true)
  );

  return server;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const allowedOrigin = req.headers.origin;

  if (
    allowedOrigin &&
    !['https://chatgpt.com', 'https://chat.openai.com'].includes(
      allowedOrigin
    )
  ) {
    res.statusCode = 403;
    res.end('Origin no permitido');
    return;
  }

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id'
  );

  res.setHeader(
    'Access-Control-Allow-Methods',
    'POST, GET, OPTIONS'
  );

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (
    !process.env.CETGPT_MCP_KEY ||
    process.env.CETGPT_MCP_KEY.length < 32
  ) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');

    res.end(JSON.stringify({
      error:
        'Configura CETGPT_MCP_KEY con al menos 32 caracteres.',
    }));
    return;
  }

  if (!validKey(req)) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');

    res.end(JSON.stringify({
      error: 'Clave de conexion ausente o incorrecta.',
    }));
    return;
  }

  if (req.method === 'GET') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 405;

    res.end(JSON.stringify({
      service: 'CetGPT WordPress MCP',
      version: '0.2.0',
      mode: 'read-write-trash',
      message:
        'Ruta MCP disponible. Conectar mediante Streamable HTTP (POST). Este GET no verifica las credenciales de WordPress.',
    }));
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.statusCode = 405;
    res.end('Metodo no permitido');
    return;
  }

  const server = createServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);

    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body)
        : req.body;

    await transport.handleRequest(req, res, body);
  } catch {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');

      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: 'No se pudo procesar la solicitud MCP.',
        },
      }));
    }
  }
}
