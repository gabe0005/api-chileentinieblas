export default async function handler(req, res) {
  const {
    slug,
    id,
    type = 'posts',
    search,
    per_page = 10,
    page = 1,
    order = 'desc',
    orderby = 'date',
    post_status = 'any',
  } = req.query;

  const baseUrl = 'https://chileentinieblas.cl/wp-json/chileentinieblas/v1/contenido';
  const url = new URL(baseUrl);

  url.searchParams.set('type', type);
  url.searchParams.set('per_page', per_page);
  url.searchParams.set('page', page);
  url.searchParams.set('order', order);
  url.searchParams.set('orderby', orderby);
  url.searchParams.set('post_status', post_status);

  if (slug) url.searchParams.set('slug', slug);
  if (id) url.searchParams.set('id', id);
  if (search) url.searchParams.set('search', search);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${process.env.WP_TOKEN}`,
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Error al consultar WordPress' });
    }

    const data = await response.json();

    // Si no hay parámetro de búsqueda, devolver los datos sin procesar
    if (!search) {
      return res.status(200).json(data);
    }

    // Procesamiento local del filtro
    const searchTerm = search.toLowerCase().trim();
    const results = data.filter((item) => {
      const title = (item.title || '').toLowerCase();
      const excerpt = (item.excerpt || '').toLowerCase();
      const content = (item.content || '').toLowerCase();
      const slug = (item.slug || '').toLowerCase();

      const acf = item.acf || {};
      const acfValues = [
        acf.nombre,
        acf.nombre_completo,
        acf.alias,
      ].map((v) => (v || '').toLowerCase());

      return (
        title.includes(searchTerm) ||
        excerpt.includes(searchTerm) ||
        content.includes(searchTerm) ||
        slug.includes(searchTerm) ||
        acfValues.some((val) => val.includes(searchTerm))
      );
    });

    return res.status(200).json(results);
  } catch (err) {
    console.error('Error en handler contenido.js:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
