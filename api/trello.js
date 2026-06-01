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

function simplifyLabel(label) {
  return {
    id: label.id,
    name: label.name,
    color: label.color,
    idBoard: label.idBoard
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
      ? card.labels.map(label => ({
          id: label.id,
          name: label.name,
          color: label.color
        }))
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
  return boards.find(board => board.name.toLowerCase().includes(term));
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
  return lists.find(list => list.name.toLowerCase().includes(term));
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
  return cards.find(card => card.name.toLowerCase().includes(term));
}

async function getLabelsByBoardId(boardId) {
  const { key, token } = getAuth();
  const url = `${baseUrl}/boards/${boardId}/labels?key=${key}&token=${token}&fields=name,color,idBoard&limit=1000`;
  const labels = await fetchJson(url);
  return labels.map(simplifyLabel);
}

function findLabelByName(labels, labelName) {
  const term = labelName.toLowerCase().trim();
  return labels.find(label =>
    (label.name || "").toLowerCase().trim() === term
  );
}

async function createLabel(boardId, labelName, color = "blue") {
  const { key, token } = getAuth();
  const url = `${baseUrl}/labels?key=${key}&token=${token}`;

  const params = new URLSearchParams();
  params.set("idBoard", boardId);
  params.set("name", labelName);
  params.set("color", color);

  const label = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });

  return simplifyLabel(label);
}

async function addLabelToCard(cardId, labelId) {
  const { key, token } = getAuth();
  const url = `${baseUrl}/cards/${cardId}/idLabels?key=${key}&token=${token}`;

  const params = new URLSearchParams();
  params.set("value", labelId);

  return await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });
}

async function resolveBoardId({ boardId, boardName }) {
  if (boardId) return boardId;

  if (boardName) {
    const board = await findBoardByName(boardName);
    if (!board) throw new Error("No se encontró el tablero.");
    return board.id;
  }

  throw new Error("Falta boardId o boardName.");
}

async function applyLabelsToCard({
  cardId,
  boardId,
  labelNames = [],
  labelIds = [],
  allowCreateLabels = false,
  labelColor = "blue"
}) {
  const appliedLabels = [];
  const missingLabels = [];

  const boardLabels = await getLabelsByBoardId(boardId);

  for (const labelId of labelIds || []) {
    await addLabelToCard(cardId, labelId);
    appliedLabels.push({ id: labelId });
  }

  for (const labelName of labelNames || []) {
    const existingLabel = findLabelByName(boardLabels, labelName);

    if (existingLabel) {
      await addLabelToCard(cardId, existingLabel.id);
      appliedLabels.push(existingLabel);
    } else if (allowCreateLabels) {
      const newLabel = await createLabel(boardId, labelName, labelColor);
      await addLabelToCard(cardId, newLabel.id);
      appliedLabels.push(newLabel);
    } else {
      missingLabels.push(labelName);
    }
  }

  return {
    appliedLabels,
    missingLabels
  };
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
      const resolvedBoardId = await resolveBoardId({ boardId, boardName });
      return jsonResponse(await getListsByBoardId(resolvedBoardId));
    }

    if (action === "getCards") {
      if (!listId) return jsonResponse({ error: "Falta listId." }, 400);

      const url = `${baseUrl}/lists/${listId}/cards?key=${key}&token=${token}&fields=name,desc,url,idList,idBoard,labels`;
      const cards = await fetchJson(url);
      return jsonResponse(cards.map(simplifyCard));
    }

    if (action === "searchCards") {
      const resolvedBoardId = await resolveBoardId({ boardId, boardName });

      let cards = await getCardsByBoardId(resolvedBoardId);

      if (search) {
        const term = search.toLowerCase().trim();

        cards = cards.filter(card => {
          const name = (card.name || "").toLowerCase();
          const desc = (card.desc || "").toLowerCase();
          const labels = Array.isArray(card.labels)
            ? card.labels.map(label => label.name).join(" ").toLowerCase()
            : "";

          return name.includes(term) || desc.includes(term) || labels.includes(term);
        });
      }

      return jsonResponse(cards);
    }

    if (action === "getLabels") {
      const resolvedBoardId = await resolveBoardId({ boardId, boardName });
      return jsonResponse(await getLabelsByBoardId(resolvedBoardId));
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
      desc,
      labelNames = [],
      labelIds = [],
      allowCreateLabels = false,
      labelColor = "blue"
    } = body;

    if (action === "createCard") {
      const resolvedBoardId = await resolveBoardId({ boardId, boardName });

      let resolvedListId = listId;

      if (!resolvedListId) {
        if (!listName) {
          return jsonResponse({ error: "Falta listName o listId." }, 400);
        }

        const list = await findListByName(resolvedBoardId, listName);
        if (!list) return jsonResponse({ error: "No se encontró la lista." }, 404);

        resolvedListId = list.id;
      }

      if (!name) {
        return jsonResponse({ error: "Falta name para crear la tarjeta." }, 400);
      }

      const { key, token } = getAuth();
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

      const simplifiedCard = simplifyCard(created);

      const labelResult = await applyLabelsToCard({
        cardId: simplifiedCard.id,
        boardId: resolvedBoardId,
        labelNames,
        labelIds,
        allowCreateLabels,
        labelColor
      });

      return jsonResponse({
        ...simplifiedCard,
        labelsApplied: labelResult.appliedLabels,
        labelsMissing: labelResult.missingLabels
      }, 201);
    }

    if (action === "updateCard") {
      let resolvedBoardId = boardId;
      let resolvedCardId = cardId;

      if (!resolvedBoardId && boardName) {
        const board = await findBoardByName(boardName);
        if (!board) return jsonResponse({ error: "No se encontró el tablero." }, 404);
        resolvedBoardId = board.id;
      }

      if (!resolvedCardId) {
        if (!resolvedBoardId) {
          return jsonResponse({ error: "Falta cardId o boardName/boardId + cardName." }, 400);
        }

        if (!cardName) {
          return jsonResponse({ error: "Falta cardName para buscar la tarjeta." }, 400);
        }

        const card = await findCardByName(resolvedBoardId, cardName);
        if (!card) return jsonResponse({ error: "No se encontró la tarjeta." }, 404);

        resolvedCardId = card.id;
      }

      const { key, token } = getAuth();
      const url = `${baseUrl}/cards/${resolvedCardId}?key=${key}&token=${token}`;

      const params = new URLSearchParams();
      if (name) params.set("name", name);
      if (desc) params.set("desc", desc);

      let updatedCard = null;

      if ([...params.keys()].length) {
        updatedCard = await fetchJson(url, {
          method: "PUT",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params
        });
      } else {
        const getUrl = `${baseUrl}/cards/${resolvedCardId}?key=${key}&token=${token}&fields=name,desc,url,idList,idBoard,labels`;
        updatedCard = await fetchJson(getUrl);
      }

      const simplifiedCard = simplifyCard(updatedCard);

      let labelResult = {
        appliedLabels: [],
        missingLabels: []
      };

      if ((labelNames && labelNames.length) || (labelIds && labelIds.length)) {
        if (!resolvedBoardId) {
          resolvedBoardId = simplifiedCard.idBoard;
        }

        labelResult = await applyLabelsToCard({
          cardId: simplifiedCard.id,
          boardId: resolvedBoardId,
          labelNames,
          labelIds,
          allowCreateLabels,
          labelColor
        });
      }

      return jsonResponse({
        ...simplifiedCard,
        labelsApplied: labelResult.appliedLabels,
        labelsMissing: labelResult.missingLabels
      });
    }

    if (action === "createLabel") {
      const resolvedBoardId = await resolveBoardId({ boardId, boardName });

      if (!name) {
        return jsonResponse({ error: "Falta name para crear la etiqueta." }, 400);
      }

      const newLabel = await createLabel(resolvedBoardId, name, labelColor);
      return jsonResponse(newLabel, 201);
    }

    return jsonResponse({ error: "Acción POST no válida." }, 400);

  } catch (error) {
    console.error("Error al modificar Trello:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
