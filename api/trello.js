// /api/trello.js

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const action = searchParams.get("action");
    const boardId = searchParams.get("boardId");
    const boardName = searchParams.get("boardName");
    const listId = searchParams.get("listId");
    const search = searchParams.get("search");

    const baseUrl = "https://api.trello.com/1";
    const key = process.env.TRELLO_KEY;
    const token = process.env.TRELLO_TOKEN;
    const auth = `key=${key}&token=${token}`;

    async function fetchJson(url) {
      const response = await fetch(url);
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(text);
      }
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
      const url = `${baseUrl}/organizations/chileentinieblas/boards?${auth}&filter=open&fields=name,url,shortLink`;
      const boards = await fetchJson(url);
      return boards.map(simplifyBoard);
    }

    async function findBoardByName(name) {
      const boards = await getBoards();
      const term = name.toLowerCase().trim();

      return boards.find(board =>
        board.name.toLowerCase().includes(term)
      );
    }

    if (action === "getBoards") {
      const boards = await getBoards();
      return jsonResponse(boards);
    }

    if (action === "searchBoards") {
      if (!boardName) {
        return jsonResponse({ error: "Falta boardName." }, 400);
      }

      const boards = await getBoards();
      const term = boardName.toLowerCase().trim();

      const matches = boards.filter(board =>
        board.name.toLowerCase().includes(term)
      );

      return jsonResponse(matches);
    }

    if (action === "getLists") {
      let resolvedBoardId = boardId;

      if (!resolvedBoardId && boardName) {
        const board = await findBoardByName(boardName);
        if (!board) {
          return jsonResponse({ error: "No se encontró un tablero con ese nombre." }, 404);
        }
        resolvedBoardId = board.id;
      }

      if (!resolvedBoardId) {
        return jsonResponse({ error: "Falta boardId o boardName." }, 400);
      }

      const url = `${baseUrl}/boards/${resolvedBoardId}/lists?${auth}&filter=open&fields=name,idBoard`;
      const lists = await fetchJson(url);

      return jsonResponse(lists.map(simplifyList));
    }

    if (action === "getCards") {
      if (!listId) {
        return jsonResponse({ error: "Falta listId." }, 400);
      }

      const url = `${baseUrl}/lists/${listId}/cards?${auth}&fields=name,desc,url,idList,idBoard,labels`;
      const cards = await fetchJson(url);

      return jsonResponse(cards.map(simplifyCard));
    }

    if (action === "searchCards") {
      let resolvedBoardId = boardId;

      if (!resolvedBoardId && boardName) {
        const board = await findBoardByName(boardName);
        if (!board) {
          return jsonResponse({ error: "No se encontró un tablero con ese nombre." }, 404);
        }
        resolvedBoardId = board.id;
      }

      if (!resolvedBoardId) {
        return jsonResponse({ error: "Falta boardId o boardName." }, 400);
      }

      const url = `${baseUrl}/boards/${resolvedBoardId}/cards?${auth}&fields=name,desc,url,idList,idBoard,labels`;
      let cards = await fetchJson(url);
      cards = cards.map(simplifyCard);

      if (search) {
        const term = search.toLowerCase().trim();

        cards = cards.filter(card => {
          const name = (card.name || "").toLowerCase();
          const desc = (card.desc || "").toLowerCase();
          const labels = Array.isArray(card.labels)
            ? card.labels.join(" ").toLowerCase()
            : "";

          return (
            name.includes(term) ||
            desc.includes(term) ||
            labels.includes(term)
          );
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

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
