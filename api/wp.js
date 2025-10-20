export default async function handler(req, res) {
  try {
    const { path, ...rest } = req.query;

    if (!path) {
      return res.status(400).json({
        error: true,
        message: "Falta el parámetro 'path' (ej: wp/v2/posts)",
      });
    }

    const baseUrl = `https://chileentinieblas.cl/wp-json/${path}`;
    const params = new URLSearchParams(rest).toString();
    const targetUrl = `${baseUrl}?${params}`;

    // Carga del token JWT desde variable de entorno (si existe)
    const jwt = process.env.JWT_TOKEN ? `Bearer ${process.env.JWT_TOKEN}` : null;

    const headers = {
      "User-Agent": "CetGPT-Proxy",
      "Accept": "application/json",
    };
    if (jwt) headers["Authorization"] = jwt;

    const response = await fetch(targetUrl, { headers });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: true,
        message: `Error desde WordPress (${response.status})`,
        details: text,
      });
    }

    const data = await response.json();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({
      error: true,
      message: "Error interno en el proxy /wp",
      details: error.message,
    });
  }
}
