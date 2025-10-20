export default async function handler(req, res) {
    try {
        const baseUrl = "https://chileentinieblas.cl/wp-json/chileentinieblas/v1/contenido";
        const params = new URLSearchParams(req.query).toString();
        const targetUrl = `${baseUrl}?${params}`;
        const response = await fetch(targetUrl, {
            headers: { "User-Agent": "CetGPT-Proxy", "Accept": "application/json" }
        });

        if (!response.ok) {
            const text = await response.text();
            return res.status(response.status).json({
                error: true,
                message: `Error desde WordPress: ${response.status}`,
                details: text
            });
        }

        const data = await response.json();
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({
            error: true,
            message: "Error interno en el proxy /contenido",
            details: error.message
        });
    }
}