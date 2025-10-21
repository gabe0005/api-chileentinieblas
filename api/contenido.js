import { NextRequest, NextResponse } from 'next/server';

export async function GET(req = NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search');

    // Construir URL base
    const apiUrl = new URL('https://chileentinieblas.cl/wp-json/chileentinieblas/v1/contenido');
    if (search) {
      apiUrl.searchParams.set('search', search);
    }

    const headers = {};
    const token = process.env.CHILE_TOKEN;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(apiUrl.toString(), {
      method: 'GET',
      headers,
    });

    const data = await response.json();

    // Log de depuración
    console.log("Respuesta de WordPress:", JSON.stringify(data, null, 2));

    const res = NextResponse.json(data, { status: 200 });
    res.headers.set('Access-Control-Allow-Origin', '*');
    return res;

  } catch (error) {
    console.error("Error al consultar contenido narrativo:", error);
    return NextResponse.json(
      { error: 'Error al consultar contenido narrativo' },
      { status: 500 }
    );
  }
}
