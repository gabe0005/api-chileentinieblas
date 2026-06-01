// /api/trello.js

const baseUrl = "https://api.trello.com/1";

function getAuth() {
  const key = process.env.TRELLO_KEY;
  const token = process.env.TRELLO_TOKEN;
  return { key, token };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data;
}

function simplifyBoard(board) {
  return {
    id: board.id,
    name: board.name,
    url: board.url,
    shortLink: board.shortLink
  };
}

function simplifyList(list) {
  return {
    id: list.id,
    name: list.name,
    idBoard: list.idBoard
  };
}

function simplifyCard(card) {
  return {
    id: card.id,
    name: card.name,
    desc: card.desc,
    url: card.url,
    idList: card.idList,
    idBoard: card.idBoard,
    labels: Array.isArray(card.labels)
      ? card.labels.map(label => label.name).filter(Boolean)
      : []
  };
}

async function getBoards() {
  const { key, token } = getAuth();
  const url = `${baseUrl}/organizations/chileentinieblas/boards?key=${key}&token=${token}&filter=open&fields=name,url,shortLink`;
  const boards = await fetchJson(url);
  return boards.map(simplifyBoard);
}

async function findBoardByName(boardName) {
  const boards = await getBoards();
  const term = boardName.toLowerCase().trim();

  return boards.find(board =>
    board.name.toLowerCase().includes(term)
  );
}

async function getListsByBoardId(boardId) {
  const { key, token } = getAuth();
  const url = `${baseUrl}/boards/${boardId}/lists?key=${key}&token=${token}&filter=open&fields=name,idBoard`;
  const lists = await fetchJson(url);
  return lists.map(simplifyList);
}

async function findListByName(boardId, listName) {
  const lists = await getListsByBoardId(boardId);
  const term = listName.toLowerCase().trim();

  return lists.find(list =>
    list.name.toLowerCase().includes(term)
  );
}

async function getCardsByBoardId(boardId) {
  const { key, token } = getAuth();
  const url = `${baseUrl}/boards/${boardId}/cards?key=${key}&token=${token}&fields=name,desc,url,idList,idBoard,labels`;
  const cards = await fetchJson(url);
  return cards.map(simplifyCard);
}

async function findCardByName(boardId, cardName) {
  const cards = await getCardsByBoardId(boardId);
  const term = cardName.toLowerCase().trim();

  return cards.find(card =>
    card.name.toLowerCase().includes(term)
  );
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const action = searchParams.get("action");
    const boardId = searchParams.get("boardId");
    const boardName = searchParams.get("boardName");
    const listId = searchParams.get("listId");
    const search = searchParams.get("search");

    const { key, token } = getAuth();

    if (action === "getBoards") {
      return jsonResponse(await getBoards());
    }

    if (action === "searchBoards") {
      if (!boardName) return jsonResponse({ error: "Falta boardName." }, 400);

      const boards = await getBoards();
      const term = boardName.toLowerCase().trim();

      return jsonResponse(
        boards.filter(board => board.name.toLowerCase().includes(term))
      );
    }

    if (action === "getLists") {
      let resolvedBoardId = boardId;

      if (!resolvedBoardId && boardName) {
        const board = await findBoardByName(boardName);
        if (!board) return jsonResponse({ error: "No se encontró el tablero." }, 404);
        resolvedBoardId = board.id;
      }

      if (!resolvedBoardId) return jsonResponse({ error: "Falta boardId o boardName." }, 400);

      return jsonResponse(await getListsByBoardId(resolvedBoardId));
    }

    if (action === "getCards") {
      if (!listId) return jsonResponse({ error: "Falta listId." }, 400);

      const url = `${baseUrl}/lists/${listId}/cards?key=${key}&token=${token}&fields=name,desc,url,idList,idBoard,labels`;
      const cards = await fetchJson(url);
      return jsonResponse(cards.map(simplifyCard));
    }

    if (action === "searchCards") {
      let resolvedBoardId = boardId;

      if (!resolvedBoardId && boardName) {
        const board = await findBoardByName(boardName);
        if (!board) return jsonResponse({ error: "No se encontró el tablero." }, 404);
        resolvedBoardId = board.id;
      }

      if (!resolvedBoardId) return jsonResponse({ error: "Falta boardId o boardName." }, 400);

      let cards = await getCardsByBoardId(resolvedBoardId);

      if (search) {
        const term = search.toLowerCase().trim();

        cards = cards.filter(card => {
          const name = (card.name || "").toLowerCase();
          const desc = (card.desc || "").toLowerCase();
          const labels = Array.isArray(card.labels)
            ? card.labels.join(" ").toLowerCase()
            : "";

          return name.includes(term) || desc.includes(term) || labels.includes(term);
        });
      }

      return jsonResponse(cards);
    }

    return jsonResponse({ error: "Acción no válida." }, 400);

  } catch (error) {
    console.error("Error al consultar Trello:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}

export async function POST(request) {
  try {
    const body = await request.json();

    const {
      action,
      boardId,
      boardName,
      listId,
      listName,
      cardId,
      cardName,
      name,
      desc
    } = body;

    const { key, token } = getAuth();

    if (action === "createCard") {
      let resolvedListId = listId;

      if (!resolvedListId) {
        if (!boardId && !boardName) {
          return jsonResponse({ error: "Falta boardId o boardName." }, 400);
        }

        if (!listName) {
          return jsonResponse({ error: "Falta listName o listId." }, 400);
        }

        let resolvedBoardId = boardId;

        if (!resolvedBoardId && boardName) {
          const board = await findBoardByName(boardName);
          if (!board) return jsonResponse({ error: "No se encontró el tablero." }, 404);
          resolvedBoardId = board.id;
        }

        const list = await findListByName(resolvedBoardId, listName);
        if (!list) return jsonResponse({ error: "No se encontró la lista." }, 404);

        resolvedListId = list.id;
      }

      if (!name) {
        return jsonResponse({ error: "Falta name para crear la tarjeta." }, 400);
      }

      const url = `${baseUrl}/cards?key=${key}&token=${token}`;

      const params = new URLSearchParams();
      params.set("idList", resolvedListId);
      params.set("name", name);
      if (desc) params.set("desc", desc);

      const created = await fetchJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params
      });

      return jsonResponse(simplifyCard(created), 201);
    }

    if (action === "updateCard") {
      let resolvedCardId = cardId;

      if (!resolvedCardId) {
        if (!boardId && !boardName) {
          return jsonResponse({ error: "Falta cardId o boardName/boardId + cardName." }, 400);
        }

        if (!cardName) {
          return jsonResponse({ error: "Falta cardName para buscar la tarjeta." }, 400);
        }

        let resolvedBoardId = boardId;

        if (!resolvedBoardId && boardName) {
          const board = await findBoardByName(boardName);
          if (!board) return jsonResponse({ error: "No se encontró el tablero." }, 404);
          resolvedBoardId = board.id;
        }

        const card = await findCardByName(resolvedBoardId, cardName);
        if (!card) return jsonResponse({ error: "No se encontró la tarjeta." }, 404);

        resolvedCardId = card.id;
      }

      const url = `${baseUrl}/cards/${resolvedCardId}?key=${key}&token=${token}`;

      const params = new URLSearchParams();
      if (name) params.set("name", name);
      if (desc) params.set("desc", desc);

      if (![...params.keys()].length) {
        return jsonResponse({ error: "No hay campos para actualizar." }, 400);
      }

      const updated = await fetchJson(url, {
        method: "PUT",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params
      });

      return jsonResponse(simplifyCard(updated));
    }

    return jsonResponse({ error: "Acción POST no válida." }, 400);

  } catch (error) {
    console.error("Error al modificar Trello:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
