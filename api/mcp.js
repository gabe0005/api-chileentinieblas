// Vercel: guardar este archivo como api/mcp.js.
// Etapa 1: lectura. No contiene herramientas ni solicitudes de escritura.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const WP_BASE = 'https://chileentinieblas.cl';
const READ = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

async function wpRead(path, params = {}, method = 'GET') {
  if (!['GET', 'OPTIONS'].includes(method)) {
    throw new Error('Solo se permite lectura.');
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
    },
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
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
      }.`
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

  return {
    content: [{ type: 'text', text }],
  };
}

function safeTool(fn) {
  return async (args) => {
    try {
      return asResult(await fn(args));
    } catch (error) {
      const message =
        error.name === 'TimeoutError'
          ? 'WordPress tardo demasiado. Intenta una consulta mas pequena.'
          : error.message || 'No se pudo consultar WordPress.';

      return {
        isError: true,
        content: [{ type: 'text', text: message }],
      };
    }
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
      version: '0.1.0',
    },
    {
      instructions:
        'Fuente narrativa de Chile en Tinieblas. Consultar antes de afirmar canon. Esta version solo permite lectura. La busqueda habitual no busca dentro de ACF ni Elementor. Los campos reservados deben tratarse como informacion para narradores. Resolver IDs con buscarContenidoNarrativo antes de consultar fichas.',
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
        type: z
          .string()
          .regex(/^[a-zA-Z0-9_-]+$/)
          .optional(),
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

      return {
        ...ficha,
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

  if (req.method === 'GET') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 405;

    res.end(
      JSON.stringify({
        service: 'CetGPT WordPress MCP',
        version: '0.1.0',
        mode: 'read-only',
        message:
          'Ruta MCP disponible. Conectar mediante Streamable HTTP (POST). Este GET no verifica las credenciales de WordPress.',
      })
    );
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

      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32603,
            message: 'No se pudo procesar la solicitud MCP.',
          },
        })
      );
    }
  }
}
