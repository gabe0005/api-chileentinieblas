// /api/wp.js
export default async function handler(req, res) {
  const { path, ...params } = req.query;

  if (!path) {
    return res.status(400).json({ error: "Missing 'path' parameter" });
  }

  const baseUrl = "https://chileentinieblas.cl/wp-json/";
  const url = new URL(`${baseUrl}${path}`);

  // Agrega los parámetros de la query
  Object.keys(params).forEach(key => {
    if (params[key]) url.searchParams.append(key, params[key]);
  });

  try {
    const response = await fetch(url.toString(), {
      headers: {
        "Content-Type": "application/json",
        // Aquí añadimos el token JWT para acceder a información privada
        "Authorization": `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEsIm5hbWUiOiJDb250cm9sIiwiaWF0IjoxNzYwODMxMjQ2LCJleHAiOjE5MTg1MTEyNDZ9.yTE54j8iNubqVO7hPuWU5FSQDUWfcsr5CCOIpqOatAg`
      }
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: "Error from WordPress API",
        status: response.status,
        message: text
      });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      error: "Proxy error",
      details: err.message
    });
  }
}
