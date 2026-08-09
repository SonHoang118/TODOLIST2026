const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const RUNS = Number(process.env.RUNS || 5);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(path, options) {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`${path} failed: ${JSON.stringify(data)}`);
  }
  return data;
}

function toTaskPayload(titleSeed, actorUserId) {
  const start = new Date();
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  return {
    scope: "COMPANY",
    actorUserId,
    tasks: [
      {
        title: `Realtime check ${titleSeed}`,
        description: `updated by user ${actorUserId}`,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        color: "bg-violet-600",
        label: "DEFAULT",
        status: "IN_PROGRESS",
        assignedFromUserId: null,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
        confirmedByUserIds: [actorUserId],
      },
    ],
  };
}

function createSseListener(path) {
  const controller = new AbortController();
  const queue = [];
  let resolver = null;

  let markReady;
  let markFailed;
  const ready = new Promise((resolve, reject) => {
    markReady = resolve;
    markFailed = reject;
  });

  void (async () => {
    try {
    const response = await fetch(`${BASE_URL}${path}`, {
      signal: controller.signal,
      headers: {
        Accept: "text/event-stream",
      },
      cache: "no-store",
    });

    if (!response.ok || !response.body) {
      throw new Error(`SSE connect failed (${response.status})`);
    }

    markReady();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const emit = (event) => {
      if (resolver) {
        const r = resolver;
        resolver = null;
        r(event);
      } else {
        queue.push(event);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const lines = rawEvent.split(/\r?\n/);
        let type = "message";
        let data = "";

        for (const line of lines) {
          if (!line || line.startsWith(":")) continue;
          if (line.startsWith("event:")) {
            type = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            data += line.slice(5).trim();
          }
        }

        emit({ type, data });
        boundary = buffer.indexOf("\n\n");
      }
    }
    } catch (error) {
      markFailed(error);
    }
  })();

  return {
    async next(type, timeoutMs = 10000) {
      await ready;

      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const foundIdx = queue.findIndex((event) => event.type === type);
        if (foundIdx >= 0) {
          return queue.splice(foundIdx, 1)[0];
        }

        const waitMs = Math.max(1, Math.min(1000, timeoutMs - (Date.now() - start)));
        const event = await Promise.race([
          new Promise((resolve) => {
            resolver = resolve;
          }),
          sleep(waitMs).then(() => null),
        ]);

        if (event && event.type === type) {
          return event;
        }
        if (event) {
          queue.push(event);
        }
      }

      throw new Error(`Timed out waiting for SSE event '${type}'`);
    },
    close() {
      controller.abort();
    },
  };
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

async function main() {
  const usersData = await getJson("/api/users", { cache: "no-store" });
  const users = Array.isArray(usersData.users) ? usersData.users : [];
  if (users.length === 0) {
    throw new Error("No users found.");
  }

  const userA = users[0];
  const userB = users[1] ?? users[0];

  const query = new URLSearchParams({
    scope: "COMPANY",
    actorUserId: String(userA.id),
  }).toString();

  const sse = createSseListener(`/api/tasks/events?${query}`);

  try {
    const first = await sse.next("tasks-version", 10000);
    const initialVersion = JSON.parse(first.data).version;
    console.log(`Initial version: ${initialVersion}`);

    const delays = [];

    for (let i = 0; i < RUNS; i += 1) {
      const payload = toTaskPayload(`${Date.now()}-${i}`, userB.id);
      const startAt = Date.now();

      await getJson("/api/tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const event = await sse.next("tasks-version", 10000);
      const parsed = JSON.parse(event.data);
      const elapsed = Date.now() - startAt;
      delays.push(elapsed);

      console.log(`Run ${i + 1}: ${elapsed}ms | version=${parsed.version}`);
      await sleep(300);
    }

    const avg = Math.round(delays.reduce((sum, v) => sum + v, 0) / delays.length);
    const p95 = percentile(delays, 0.95);
    const max = Math.max(...delays);
    const min = Math.min(...delays);

    console.log("--- Summary ---");
    console.log(`Users tested: A=${userA.name}(${userA.id}), B=${userB.name}(${userB.id})`);
    console.log(`Runs: ${RUNS}`);
    console.log(`Latency min/avg/p95/max: ${min} / ${avg} / ${p95} / ${max} ms`);

    if (p95 > 3000) {
      console.log("Recommendation: reduce server version poll interval or switch to push-on-write in-memory broadcast.");
    } else if (p95 > 1500) {
      console.log("Recommendation: keep current setup but consider reducing server version poll interval from 2500ms to 1500ms.");
    } else {
      console.log("Recommendation: current interval is acceptable.");
    }
  } finally {
    sse.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
