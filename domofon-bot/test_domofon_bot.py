"""Тесты без сети: Дом.ру поднимается локальным сервером, Telegram подменяется."""

import json
import threading
import unittest
import unittest.mock
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import domofon_bot as bot

JPEG = b"\xff\xd8\xff\xe0fake-jpeg"


class FakeDomRuServer(BaseHTTPRequestHandler):
    requests = []
    expired_tokens = set()
    events = []

    def log_message(self, *args):
        pass

    def _reply(self, status, body=b"", content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _record(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        FakeDomRuServer.requests.append((self.command, self.path, dict(self.headers), body))

    def _authorized(self):
        token = self.headers.get("Authorization", "").removeprefix("Bearer ")
        if token in self.expired_tokens:
            self._reply(401, b'{"error":"expired"}')
            return False
        return True

    def do_GET(self):
        self._record()
        if self.path == "/auth/v2/session/refresh":
            if self.headers.get("Bearer") != "refresh-1":
                return self._reply(409)
            return self._reply(200, json.dumps({"accessToken": "access-2", "refreshToken": "refresh-2"}).encode())
        if not self._authorized():
            return
        if self.path.startswith("/rest/v1/places/11/events"):
            return self._reply(200, json.dumps({"data": self.events}).encode())
        if self.path == "/rest/v1/places/11/accesscontrols/22/videosnapshots":
            return self._reply(200, JPEG, "image/jpeg")
        if self.path == "/rest/v1/subscriberplaces":
            return self._reply(200, json.dumps({"data": [{"place": {
                "id": 11, "address": {"visibleAddress": "Волгоград, Профсоюзная 16"},
                "accessControls": [{"id": 22, "name": "Калитка 2"}]}}]}).encode())
        self._reply(404)

    def do_POST(self):
        self._record()
        if not self._authorized():
            return
        if self.path == "/rest/v1/places/11/accesscontrols/22/actions":
            return self._reply(200, b'{"data":{"status":true}}')
        self._reply(404)


class FakeTelegram:
    def __init__(self):
        self.sent = []

    def call(self, method, http_timeout=30, **params):
        self.sent.append((method, params))
        return {"message_id": 1}

    def send_photo(self, chat_id, photo, caption, reply_markup=None):
        self.sent.append(("sendPhoto", {"chat_id": chat_id, "photo": photo, "caption": caption,
                                        "reply_markup": reply_markup}))
        return {"message_id": 1}

    def methods(self):
        return [m for m, _ in self.sent]


def make_config(**overrides):
    config = dict(bot.DEFAULTS, uuid="test-uuid", operator_id=7, access_token="access-1",
                  refresh_token="refresh-1", place_id=11, access_control_id=22,
                  door_name="Калитка 2", allowed_chat_ids=[100])
    config.update(overrides)
    return config


class DomRuApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeDomRuServer)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.old_api = bot.API
        bot.API = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        bot.API = cls.old_api
        cls.server.shutdown()

    def setUp(self):
        FakeDomRuServer.requests = []
        FakeDomRuServer.expired_tokens = set()
        FakeDomRuServer.events = []

    def test_open_door_sends_action_with_app_headers(self):
        bot.DomRu(make_config()).open_door()
        method, path, headers, body = FakeDomRuServer.requests[-1]
        self.assertEqual((method, path), ("POST", "/rest/v1/places/11/accesscontrols/22/actions"))
        self.assertEqual(json.loads(body), {"name": "accessControlOpen"})
        self.assertEqual(headers["Authorization"], "Bearer access-1")
        self.assertEqual(headers["Operator"], "7")
        self.assertTrue(headers["User-Agent"].endswith("| 7 | test-uuid | 11"))

    def test_expired_token_is_refreshed_saved_and_retried(self):
        FakeDomRuServer.expired_tokens = {"access-1"}
        saved = []
        config = make_config()
        domru = bot.DomRu(config, on_tokens=lambda: saved.append(config["access_token"]))
        self.assertEqual(domru.snapshot(), JPEG)
        self.assertEqual((config["access_token"], config["refresh_token"]), ("access-2", "refresh-2"))
        self.assertEqual(saved, ["access-2"])

    def test_dead_refresh_token_asks_to_login_again(self):
        FakeDomRuServer.expired_tokens = {"access-1"}
        with self.assertRaisesRegex(RuntimeError, "login"):
            bot.DomRu(make_config(refresh_token="old")).open_door()

    def test_places_lists_doors(self):
        self.assertEqual(bot.DomRu(make_config()).places(),
                         [(11, "Волгоград, Профсоюзная 16", [(22, "Калитка 2")])])

    def test_call_event_end_to_end(self):
        config = make_config()
        tg = FakeTelegram()
        b = bot.Bot(config, bot.DomRu(config), tg)
        watcher = bot.EventWatcher(b.domru.events)

        FakeDomRuServer.events = [{"id": "old", "eventTypeName": "accessControlCallMissed"}]
        self.assertEqual(watcher.poll(), [])  # старые звонки при запуске не присылаем

        FakeDomRuServer.events.insert(0, {"id": "new", "eventTypeName": "accessControlCallMissed",
                                          "timestamp": "2026-10-24T15:00:00"})
        fresh = watcher.poll()
        self.assertEqual([e["id"] for e in fresh], ["new"])
        self.assertTrue(bot.is_call_event(fresh[0], config["call_event_markers"]))

        b.notify("🔔 Звонок в домофон")
        method, params = tg.sent[-1]
        self.assertEqual(method, "sendPhoto")
        self.assertEqual(params["photo"], JPEG)
        button = params["reply_markup"]["inline_keyboard"][0][0]
        self.assertEqual(button["text"], "🔓 Открыть")

        b.handle({"update_id": 1, "callback_query": {
            "id": "q1", "data": button["callback_data"], "from": {"first_name": "Влад"},
            "message": {"message_id": 5, "chat": {"id": 100}, "caption": "🔔 Звонок"}}})
        self.assertEqual(FakeDomRuServer.requests[-1][1], "/rest/v1/places/11/accesscontrols/22/actions")
        self.assertIn(("answerCallbackQuery", {"callback_query_id": "q1", "text": "Открыто ✅"}), tg.sent)
        method, params = tg.sent[-1]
        self.assertEqual(method, "editMessageCaption")
        self.assertIn("✅ Открыто", params["caption"])
        self.assertIn("Влад", params["caption"])


class BotRulesTest(unittest.TestCase):
    def setUp(self):
        self.tg = FakeTelegram()
        self.domru = unittest.mock.Mock()
        self.bot = bot.Bot(make_config(), self.domru, self.tg)

    def press(self, data, chat=100):
        self.bot.handle({"update_id": 1, "callback_query": {
            "id": "q", "data": data, "from": {},
            "message": {"message_id": 5, "chat": {"id": chat}, "caption": "x"}}})
        return self.tg.sent[0][1]["text"]

    def test_stranger_cannot_open(self):
        self.assertEqual(self.press(bot.open_keyboard()["inline_keyboard"][0][0]["callback_data"], chat=999),
                         "Нет доступа")
        self.domru.open_door.assert_not_called()

    def test_old_button_does_not_open(self):
        stale = f"open:{int(bot.time.time()) - 600}"
        self.assertIn("устарела", self.press(stale))
        self.domru.open_door.assert_not_called()

    def test_stranger_start_gets_only_chat_id(self):
        self.bot.handle({"update_id": 1, "message": {"chat": {"id": 999}, "text": "/start"}})
        self.assertEqual(self.tg.methods(), ["sendMessage"])
        self.assertIn("999", self.tg.sent[0][1]["text"])
        self.bot.handle({"update_id": 2, "message": {"chat": {"id": 999}, "text": "/photo"}})
        self.assertEqual(self.tg.methods(), ["sendMessage"])
        self.domru.snapshot.assert_not_called()

    def test_photo_without_camera_falls_back_to_text_with_button(self):
        self.domru.snapshot.side_effect = RuntimeError("нет камеры")
        self.bot.handle({"update_id": 1, "message": {"chat": {"id": 100}, "text": "/open"}})
        method, params = self.tg.sent[-1]
        self.assertEqual(method, "sendMessage")
        self.assertIn("кадр недоступен", params["text"])
        self.assertIn("reply_markup", params)

    def test_non_call_events_are_ignored_by_default(self):
        self.assertFalse(bot.is_call_event({"eventTypeName": "accessControlOpen"}, ["call"]))
        self.assertTrue(bot.is_call_event({"eventTypeName": "x", "message": "Входящий CALL"}, ["call"]))

    def test_multipart_contains_fields_and_photo(self):
        body, content_type = bot.multipart({"chat_id": "1", "caption": "Звонок"}, "photo", "s.jpg", JPEG)
        boundary = content_type.split("boundary=")[1]
        self.assertTrue(body.endswith(f"--{boundary}--\r\n".encode()))
        self.assertIn("Звонок".encode(), body)
        self.assertIn(JPEG, body)



if __name__ == "__main__":
    unittest.main()
