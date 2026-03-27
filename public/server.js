const http = require("http");
const fs = require("fs");
const path = require("path");
const { neon } = require("@neondatabase/serverless");

const sql = neon(process.env.DATABASE_URL);

async function initDB() {
  await sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      priority TEXT DEFAULT 'medium',
      category TEXT DEFAULT 'general',
      completed BOOLEAN DEFAULT false,
      created_at TEXT,
      due_date TEXT
    )
  `;
  console.log("✅ Database ready");
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && pathname === "/") {
    serveFile(res, path.join(__dirname, "public", "index.html"), "text/html");
    return;
  }

  if (req.method === "GET" && !pathname.startsWith("/api")) {
    const filePath = path.join(__dirname, "public", pathname);
    const ext = path.extname(pathname);
    const types = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".png": "image/png",
      ".jpg": "image/jpeg",
    };
    const contentType = types[ext] || "text/plain";
    serveFile(res, filePath, contentType);
    return;
  }

  if (pathname === "/api/tasks") {
    if (req.method === "GET") {
      const tasks = await sql`
        SELECT * FROM tasks ORDER BY created_at DESC
      `;
      sendJSON(res, 200, tasks.map(formatTask));
    } else if (req.method === "POST") {
      try {
        const body = await parseBody(req);
        if (!body.title?.trim()) {
          sendJSON(res, 400, { error: "Title is required" });
          return;
        }
        const id = generateId();
        const createdAt = new Date().toISOString();
        await sql`
          INSERT INTO tasks (id, title, description, priority, category, completed, created_at, due_date)
          VALUES (
            ${id},
            ${body.title.trim()},
            ${body.description?.trim() || ""},
            ${body.priority || "medium"},
            ${body.category || "general"},
            false,
            ${createdAt},
            ${body.dueDate || null}
          )
        `;
        const [task] = await sql`SELECT * FROM tasks WHERE id = ${id}`;
        sendJSON(res, 201, formatTask(task));
      } catch (e) {
        console.error(e);
        sendJSON(res, 400, { error: "Bad request" });
      }
    }
  } else if (pathname.startsWith("/api/tasks/")) {
    const id = pathname.split("/api/tasks/")[1];
    const [task] = await sql`SELECT * FROM tasks WHERE id = ${id}`;

    if (!task) {
      sendJSON(res, 404, { error: "Task not found" });
      return;
    }

    if (req.method === "PUT") {
      try {
        const body = await parseBody(req);
        await sql`
          UPDATE tasks SET
            title = ${body.title ?? task.title},
            description = ${body.description ?? task.description},
            priority = ${body.priority ?? task.priority},
            category = ${body.category ?? task.category},
            completed = ${body.completed ?? task.completed},
            due_date = ${body.dueDate ?? task.due_date}
          WHERE id = ${id}
        `;
        const [updated] = await sql`SELECT * FROM tasks WHERE id = ${id}`;
        sendJSON(res, 200, formatTask(updated));
      } catch (e) {
        console.error(e);
        sendJSON(res, 400, { error: "Bad request" });
      }
    } else if (req.method === "DELETE") {
      await sql`DELETE FROM tasks WHERE id = ${id}`;
      sendJSON(res, 200, { message: "Deleted" });
    }
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

function formatTask(t) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    priority: t.priority,
    category: t.category,
    completed: t.completed,
    createdAt: t.created_at,
    dueDate: t.due_date,
  };
}

const PORT = process.env.PORT || 3000;

initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 Task Manager running at http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error("❌ DB init failed:", err);
  process.exit(1);
});