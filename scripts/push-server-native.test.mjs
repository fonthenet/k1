// The phone half of the push dispatcher must leave on its own: a queue with no
// browser row in it, or a deploy without VAPID keys, used to end the pass
// before Expo was ever called, and the evening journal never reached the app.
// This drives dispatchPendingPush over a database stub and a recording fetch,
// so the contract — one POST to Expo per chunk, `channelId: "default"`, the
// routing `type` inside `data`, kg_mark_pushed on whatever was delivered —
// is checked here rather than on a parent's phone.
//
//   node --test scripts/push-server-native.test.mjs
//
// Same resolve/load hook as notifications.test.mjs (`@/` onto src/, types
// stripped with the TypeScript compiler in node_modules), plus two things this
// module needs and Node does not have: `server-only` is a Next alias, so it
// resolves to an empty module here; the message files are imported as JSON
// without an import attribute, so the hook loads them itself.
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

register(
  `data:text/javascript,${encodeURIComponent(`
    import { existsSync } from "node:fs";
    import { readFile } from "node:fs/promises";
    import { pathToFileURL, fileURLToPath } from "node:url";
    const root = ${JSON.stringify(root)};
    const ts = (await import(pathToFileURL(root + "/node_modules/typescript/lib/typescript.js").href)).default;
    const withExt = (p) => {
      for (const c of [p, p + ".ts", p + ".tsx", p + "/index.ts", p + "/index.tsx"]) if (existsSync(c) && !c.endsWith("/")) return c;
      return null;
    };
    export async function resolve(specifier, context, next) {
      if (specifier === "server-only") {
        return { url: "data:text/javascript,", shortCircuit: true };
      }
      if (specifier.startsWith("@/")) {
        const hit = withExt(root + "/src/" + specifier.slice(2));
        if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
      }
      if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
        const base = fileURLToPath(new URL(specifier, context.parentURL));
        if (!/\\.[cm]?[jt]sx?$|\\.json$/.test(base)) {
          const hit = withExt(base);
          if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
        }
      }
      return next(specifier, context);
    }
    export async function load(url, context, next) {
      if (/\\.tsx?$/.test(url)) {
        const source = await readFile(fileURLToPath(url), "utf8");
        const { outputText } = ts.transpileModule(source, {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
          fileName: fileURLToPath(url),
        });
        return { format: "module", source: outputText, shortCircuit: true };
      }
      if (/\\.json$/.test(url) && url.startsWith("file:")) {
        const source = await readFile(fileURLToPath(url), "utf8");
        return { format: "module", source: "export default " + source + ";", shortCircuit: true };
      }
      return next(url, context);
    }
  `)}`,
  { parentURL: pathToFileURL(root + "/").href }
);

// Enough environment for the pass to start, and no VAPID pair: the case the
// spec is about. The one test that wants the browser half sets the keys itself.
process.env.PUSH_DISPATCH_SECRET = "test-secret";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

const { dispatchPendingPush } = await import(pathToFileURL(path.join(root, "src/lib/push-server.ts")).href);
const webpush = (await import("web-push")).default;

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// One evening-journal row for one parent's phone, as kg_pending_native_push
// returns it since 0159 (`is_staff` decided by the database).
const NOTIFICATION_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "ExponentPushToken[test-device]";
const nativeRow = () => ({
  notification_id: NOTIFICATION_ID,
  user_id: "33333333-3333-4333-8333-333333333333",
  locale: "ar",
  type: "daily_report",
  title: "Adam Amrani",
  body: null,
  data: { childId: CHILD_ID, date: "2026-09-13", childName: "Adam Amrani", childNameAr: "آدم عمراني", source: "journal" },
  created_at: "2026-09-13T16:30:00+01:00",
  token: TOKEN,
  platform: "android",
  is_staff: false,
});

/**
 * A database that answers each RPC from `answers` and remembers every call,
 * and a fetch that records each request to Expo and replies with `tickets`.
 */
function harness({ answers, tickets = [{ status: "ok" }], respond } = {}) {
  const calls = [];
  const requests = [];
  const db = {
    async rpc(fn, args) {
      calls.push({ fn, args });
      const answer = answers[fn];
      if (answer === undefined) return { data: null, error: null };
      return { data: typeof answer === "function" ? answer(args) : answer, error: null };
    },
  };
  const fetch = async (url, init) => {
    requests.push({ url, init, messages: JSON.parse(init.body) });
    if (respond) return respond();
    return { ok: true, json: async () => ({ data: tickets }) };
  };
  const rpcCalls = (fn) => calls.filter((c) => c.fn === fn);
  return { deps: { client: () => db, fetch }, requests, rpcCalls };
}

test("without VAPID keys the web queue is left alone and the phone row still leaves through Expo", async () => {
  const h = harness({ answers: { kg_pending_push: [], kg_pending_native_push: [nativeRow()] } });

  const result = await dispatchPendingPush(200, h.deps);

  // The browser half never ran: no keys, no kg_pending_push, no web counts.
  assert.equal(h.rpcCalls("kg_pending_push").length, 0);
  assert.deepEqual({ sent: result.sent, failed: result.failed, dropped: result.dropped, pending: result.pending },
    { sent: 0, failed: 0, dropped: 0, pending: 0 });
  assert.equal(result.skipped, "no VAPID keys (web only)");

  // The phone half did: one POST to Expo carrying the one message.
  assert.equal(h.requests.length, 1);
  const [req] = h.requests;
  assert.equal(req.url, EXPO_PUSH_URL);
  assert.equal(req.init.method, "POST");
  assert.equal(req.messages.length, 1);
  const [msg] = req.messages;
  assert.equal(msg.to, TOKEN);
  assert.equal(msg.channelId, "default");
  assert.equal(msg.sound, "default");
  assert.equal(msg.data.type, "daily_report");
  assert.equal(msg.data.childId, CHILD_ID);
  // A parent row lands on the child's day, rendered in the row's own locale.
  assert.equal(msg.data.url, `/portal/children/${CHILD_ID}/day/2026-09-13`);
  assert.ok(msg.title.includes("آدم عمراني"), msg.title);
  assert.ok(!msg.title.includes("{") && !(msg.body ?? "").includes("{"), `${msg.title} / ${msg.body}`);

  assert.deepEqual(result.native, { sent: 1, failed: 0, dropped: 0, pending: 1 });

  // Delivered on one transport is delivered: marked once, with that id.
  const marked = h.rpcCalls("kg_mark_pushed");
  assert.equal(marked.length, 1);
  assert.deepEqual(marked[0].args, { p_secret: "test-secret", p_ids: [NOTIFICATION_ID] });
});

test("an empty native queue does not reach Expo and marks nothing", async () => {
  const h = harness({ answers: { kg_pending_push: [], kg_pending_native_push: [] } });

  const result = await dispatchPendingPush(200, h.deps);

  assert.equal(h.requests.length, 0);
  assert.equal(h.rpcCalls("kg_mark_pushed").length, 0);
  assert.deepEqual(result.native, { sent: 0, failed: 0, dropped: 0, pending: 0 });
  assert.equal(result.skipped, "no VAPID keys (web only)");
});

test("a DeviceNotRegistered ticket drops the device and still counts the notification as pushed", async () => {
  const h = harness({
    answers: { kg_pending_push: [], kg_pending_native_push: [nativeRow()] },
    tickets: [{ status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }],
  });

  const result = await dispatchPendingPush(200, h.deps);

  assert.deepEqual(result.native, { sent: 0, failed: 0, dropped: 1, pending: 1 });
  const dropped = h.rpcCalls("kg_drop_push_device");
  assert.equal(dropped.length, 1);
  assert.deepEqual(dropped[0].args, { p_secret: "test-secret", p_token: TOKEN });
  assert.deepEqual(h.rpcCalls("kg_mark_pushed")[0].args.p_ids, [NOTIFICATION_ID]);
});

test("an Expo outage leaves the row pending for the next pass", async () => {
  const h = harness({
    answers: { kg_pending_push: [], kg_pending_native_push: [nativeRow()] },
    respond: () => ({ ok: false, status: 503, json: async () => ({}) }),
  });

  const result = await dispatchPendingPush(200, h.deps);

  assert.deepEqual(result.native, { sent: 0, failed: 1, dropped: 0, pending: 1 });
  assert.equal(h.rpcCalls("kg_mark_pushed").length, 0);
});

test("with VAPID keys the web queue is read too, and the phone row leaves exactly once", async () => {
  const keys = webpush.generateVAPIDKeys();
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  try {
    const h = harness({ answers: { kg_pending_push: [], kg_pending_native_push: [nativeRow()] } });

    const result = await dispatchPendingPush(200, h.deps);

    assert.equal(h.rpcCalls("kg_pending_push").length, 1);
    assert.deepEqual(h.rpcCalls("kg_pending_push")[0].args, { p_secret: "test-secret", p_limit: 200 });
    assert.equal(result.skipped, undefined);
    assert.equal(h.requests.length, 1);
    assert.deepEqual(result.native, { sent: 1, failed: 0, dropped: 0, pending: 1 });
    assert.deepEqual(h.rpcCalls("kg_mark_pushed")[0].args.p_ids, [NOTIFICATION_ID]);
  } finally {
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  }
});
