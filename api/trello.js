// /api/trello.js

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action'); // ej: getBoards, getLists, getCards
    const boardId = searchParams.get('boardId');
    const listId = searchParams.get('listId');

    const baseUrl = 'https://api.trello.com/1';
    const key = process.env.TRELLO_KEY;
    const token = process.env.TRELLO_TOKEN;

    let url = '';

    switch (action) {
      case 'getBoards':
        url = `${baseUrl}/members/me/boards?key=${key}&token=${token}`;
        break;
      case 'getLists':
        if (!boardId) throw new Error('Falta boardId');
        url = `${baseUrl}/boards/${boardId}/lists?key=${key}&token=${token}`;
        break;
      case 'getCards':
        if (!listId) throw new Error('Falta listId');
        url = `${baseUrl}/lists/${listId}/cards?key=${key}&token=${token}`;
        break;
      default:
        throw new Error('Acción no válida');
    }

    const trelloRes = await fetch(url);
    const data = await trelloRes.json();

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error al consultar Trello:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
