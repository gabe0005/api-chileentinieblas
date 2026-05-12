export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const apiUrl = new URL(
      'https://chileentinieblas.cl/wp-json/chileentinieblas/v1/contenido'
    );

    // Pasar todos los parámetros permitidos
    const paramsToForward = [
      'search',
      'slug',
      'type',
      'post_status',
      'orderby',
      'order',
      'page',
      'per_page',
    ];

    for (const param of paramsToForward) {
      const value = searchParams.get(param);
      if (value !== null) {
        apiUrl.searchParams.set(param, value);
      }
    }

    // Establecer valores por defecto si no están
    if (!apiUrl.searchParams.has('per_page')) {
      apiUrl.searchParams.set('per_page', '1000');
    }

    if (!apiUrl.searchParams.has('post_status')) {
      apiUrl.searchParams.set('post_status', 'any');
    }

    // Autenticación nativa de WordPress mediante Application Password
    const wpUser = process.env.WP_API_USER;
    const wpAppPassword = process.env.WP_APP_PASSWORD;

    if (!wpUser || !wpAppPassword) {
      console.error('Faltan WP_API_USER o WP_APP_PASSWORD en Vercel.');

      return new Response(
        JSON.stringify({
          status: 'error',
          error: 'MissingWordPressCredentials',
          error_description:
            'Faltan credenciales de WordPress en la configuración del servidor.',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const basicAuth = Buffer.from(
      `${wpUser}:${wpAppPassword}`
    ).toString('base64');

    const headers = {
      Authorization: `Basic ${basicAuth}`,
    };

    const response = await fetch(apiUrl.toString(), {
      method: 'GET',
      headers,
      cache: 'no-store',
    });

    let data;

    try {
      data = await response.json();
    } catch {
      const rawText = await response.text();

      console.error('WordPress no devolvió JSON válido:', rawText);

      return new Response(
        JSON.stringify({
          status: 'error',
          error: 'InvalidWordPressResponse',
          error_description: 'WordPress no devolvió una respuesta JSON válida.',
        }),
        {
          status: 502,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    console.log('Respuesta de WordPress:', JSON.stringify(data, null, 2));

    // Si WordPress devolvió un error HTTP, respetarlo
    if (!response.ok) {
      return new Response(JSON.stringify(data), {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Si el endpoint devuelve un error lógico con HTTP 200, marcarlo como fallo
    if (data?.status === 'error') {
      return new Response(JSON.stringify(data), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error al consultar contenido narrativo:', error);

    return new Response(
      JSON.stringify({
        status: 'error',
        error: 'ContenidoNarrativoRequestFailed',
        error_description: 'Error al consultar contenido narrativo.',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}
