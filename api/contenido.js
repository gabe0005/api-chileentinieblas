export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');

    const apiUrl = new URL('https://chileentinieblas.cl/wp-json/chileentinieblas/v1/contenido');
    if (search) {
      apiUrl.searchParams.set('search', search);
    }

    const headers = {};
    const token = process.env.CHILE_TOKEN;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      console.log('Token reenviado:', headers['Authorization']);  // Para debug
    }

    const response = await fetch(apiUrl.toString(), {
      method: 'GET',
      headers,
    });

    const data = await response.json();

    // ✅ Log de depuración
    console.log("Respuesta de WordPress:", JSON.stringify(data, null, 2));

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });

  } catch (error) {
    console.error('Error al consultar contenido narrativo:', error);
    return new Response(
      JSON.stringify({ error: 'Error al consultar contenido narrativo' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      }
    );
  }
}
