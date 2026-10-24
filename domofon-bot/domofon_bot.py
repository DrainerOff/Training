#!/usr/bin/env python3
"""Домофон Дом.ру → Telegram.

Звонок в домофон приходит в Telegram с кадром с камеры и кнопкой «Открыть».

Работает на неофициальном API приложения «Умный дом.ру» (myhome.proptech.ru),
тем же, что использует https://github.com/ad/domru. Дом.ру может поменять его
без предупреждения.

Команды:
    python3 domofon_bot.py login   вход по номеру телефона и SMS
    python3 domofon_bot.py check   проверить доступ: адрес, двери, события, кадр
    python3 domofon_bot.py run     запустить бота
"""

import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid

API = "https://myhome.proptech.ru"
TELEGRAM_API = "https://api.telegram.org"
CONFIG_PATH = os.environ.get(
    "DOMOFON_CONFIG", os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
)

DEFAULTS = {
    "telegram_token": "",
    "allowed_chat_ids": [],
    "phone": "",
    "uuid": "",
    "operator_id": 0,
    "access_token": "",
    "refresh_token": "",
    "place_id": 0,
    "access_control_id": 0,
    "door_name": "",
    "poll_seconds": 3,
    "open_button_ttl": 180,
    "call_event_markers": ["call"],
    "notify_all_events": False,
}


# ---------- Конфиг ----------

def load_config(path=CONFIG_PATH):
    config = dict(DEFAULTS)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            config.update(json.load(f))
    if not config["uuid"]:
        config["uuid"] = str(uuid.uuid4())
    return config


def save_config(config, path=CONFIG_PATH):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
    try:
        os.chmod(path, 0o600)  # в файле токены
    except OSError:
        pass


def log(*args):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), *args, flush=True)


# ---------- HTTP ----------

class HttpError(Exception):
    def __init__(self, status, body):
        super().__init__(f"HTTP {status}: {body[:300]!r}")
        self.status = status
        self.body = body


def http(method, url, headers=None, body=None, timeout=30):
    """Возвращает (status, content_type, bytes). На 4xx/5xx бросает HttpError."""
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.headers.get("Content-Type", ""), resp.read()
    except urllib.error.HTTPError as e:
        raise HttpError(e.code, e.read().decode("utf-8", "replace")) from None


# ---------- Дом.ру ----------

class DomRu:
    def __init__(self, config, on_tokens=None):
        self.config = config
        self.on_tokens = on_tokens or (lambda: None)
        self._lock = threading.Lock()

    def _user_agent(self, place_id=None):
        c = self.config
        return (
            "Google sdkgphone64x8664 | Android 14 | erth | 8.26.0 (82600010) | "
            f"| {c['operator_id']} | {c['uuid']} | {place_id or c['place_id'] or 1}"
        )

    def _headers(self, place_id=None, auth=True):
        headers = {
            "Content-Type": "application/json; charset=UTF-8",
            "User-Agent": self._user_agent(place_id),
            "Accept": "*/*",
        }
        if auth:
            headers["Operator"] = str(self.config["operator_id"])
            headers["Authorization"] = "Bearer " + self.config["access_token"]
        return headers

    def _call(self, method, path, payload=None, auth=True, place_id=None):
        body = json.dumps(payload).encode() if payload is not None else None
        try:
            return http(method, API + path, self._headers(place_id, auth), body)
        except HttpError as e:
            if not auth or e.status != 401:
                raise
            self.refresh()
            return http(method, API + path, self._headers(place_id, auth), body)

    def _json(self, *args, **kwargs):
        _, _, data = self._call(*args, **kwargs)
        return json.loads(data) if data else None

    # Вход

    def accounts(self, phone):
        return self._json("GET", f"/auth/v2/login/{phone}", auth=False)

    def request_sms(self, phone, account):
        self._call("POST", f"/auth/v2/confirmation/{phone}", account, auth=False,
                   place_id=account.get("placeId"))

    def confirm_sms(self, phone, account, code):
        tokens = self._json("POST", f"/auth/v2/auth/{phone}/confirmation", {
            "confirm1": code,
            "subscriberId": account.get("subscriberId"),
            "login": phone,
            "operatorId": account.get("operatorId"),
            "accountId": account.get("accountId"),
            "profileId": account.get("profileId"),
        }, auth=False, place_id=account.get("placeId"))
        self.config["operator_id"] = account.get("operatorId") or 0
        self._set_tokens(tokens)

    def refresh(self):
        with self._lock:
            headers = self._headers(auth=False)
            headers["Operator"] = str(self.config["operator_id"])
            headers["Bearer"] = self.config["refresh_token"]
            try:
                _, _, data = http("GET", API + "/auth/v2/session/refresh", headers)
            except HttpError as e:
                if e.status == 409:
                    raise RuntimeError("Сессия Дом.ру истекла, выполни: python3 domofon_bot.py login") from None
                raise
            self._set_tokens(json.loads(data))
            log("Токен Дом.ру обновлён")

    def _set_tokens(self, tokens):
        self.config["access_token"] = tokens["accessToken"]
        self.config["refresh_token"] = tokens["refreshToken"]
        self.on_tokens()

    # Домофон

    def places(self):
        """[(place_id, адрес, [(access_control_id, название), ...]), ...]"""
        result = []
        for item in (self._json("GET", "/rest/v1/subscriberplaces") or {}).get("data", []):
            place = item.get("place", {})
            doors = [(ac["id"], ac.get("name", "")) for ac in place.get("accessControls", [])]
            result.append((place.get("id"), place.get("address", {}).get("visibleAddress", ""), doors))
        return result

    def events(self):
        place = self.config["place_id"]
        data = self._json("GET", f"/rest/v1/places/{place}/events?allowExtentedActions=true", place_id=place)
        return (data or {}).get("data", [])

    def snapshot(self):
        place, door = self.config["place_id"], self.config["access_control_id"]
        _, content_type, data = self._call(
            "GET", f"/rest/v1/places/{place}/accesscontrols/{door}/videosnapshots", place_id=place)
        if not content_type.startswith("image/") or not data:
            raise RuntimeError(f"Камера вернула не картинку ({content_type or 'пусто'})")
        return data

    def open_door(self):
        place, door = self.config["place_id"], self.config["access_control_id"]
        self._call("POST", f"/rest/v1/places/{place}/accesscontrols/{door}/actions",
                   {"name": "accessControlOpen"}, place_id=place)


# ---------- События ----------

def is_call_event(event, markers):
    text = f"{event.get('eventTypeName', '')} {event.get('message', '')}".lower()
    return any(m.lower() in text for m in markers)


class EventWatcher:
    """Отдаёт только события, которых ещё не видел. Первый опрос ничего не отдаёт."""

    def __init__(self, fetch):
        self.fetch = fetch
        self.seen = None

    def poll(self):
        events = self.fetch()
        ids = [self._key(e) for e in events]
        if self.seen is None:
            self.seen = set(ids)
            return []
        fresh = [e for e, k in zip(events, ids) if k not in self.seen]
        self.seen.update(ids)
        if len(self.seen) > 5000:
            self.seen = set(ids)
        fresh.sort(key=lambda e: e.get("timestamp", ""))
        return fresh

    @staticmethod
    def _key(event):
        return event.get("id") or f"{event.get('timestamp')}|{event.get('eventTypeName')}"


# ---------- Telegram ----------

class Telegram:
    def __init__(self, token):
        self.base = f"{TELEGRAM_API}/bot{token}/"

    def call(self, method, http_timeout=30, **params):
        body = json.dumps(params).encode()
        _, _, data = http("POST", self.base + method, {"Content-Type": "application/json"}, body, http_timeout)
        return json.loads(data)["result"]

    def send_photo(self, chat_id, photo, caption, reply_markup=None):
        fields = {"chat_id": str(chat_id), "caption": caption}
        if reply_markup:
            fields["reply_markup"] = json.dumps(reply_markup)
        body, content_type = multipart(fields, "photo", "snapshot.jpg", photo)
        _, _, data = http("POST", self.base + "sendPhoto", {"Content-Type": content_type}, body)
        return json.loads(data)["result"]


def multipart(fields, file_field, filename, file_bytes):
    boundary = "----domofon" + uuid.uuid4().hex
    parts = []
    for name, value in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'
        "Content-Type: image/jpeg\r\n\r\n".encode() + file_bytes + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def open_keyboard(now=None):
    stamp = int(now if now is not None else time.time())
    return {"inline_keyboard": [[
        {"text": "🔓 Открыть", "callback_data": f"open:{stamp}"},
        {"text": "📷 Обновить", "callback_data": "photo"},
    ]]}


def button_expired(callback_data, ttl, now=None):
    try:
        stamp = int(callback_data.split(":", 1)[1])
    except (IndexError, ValueError):
        return True
    return (now if now is not None else time.time()) - stamp > ttl


# ---------- Бот ----------

class Bot:
    def __init__(self, config, domru, telegram):
        self.config = config
        self.domru = domru
        self.tg = telegram
        self.allowed = {int(c) for c in config["allowed_chat_ids"]}

    def door_title(self):
        return self.config["door_name"] or "Домофон"

    # Звонок

    def notify(self, title, with_button=True):
        markup = open_keyboard() if with_button else None
        caption = f"{title}\n{self.door_title()} · {time.strftime('%H:%M:%S')}"
        try:
            photo = self.domru.snapshot()
        except Exception as e:
            log("Кадр не получен:", e)
            photo = None
        for chat in self.allowed:
            try:
                if photo:
                    self.tg.send_photo(chat, photo, caption, markup)
                else:
                    self.tg.call("sendMessage", chat_id=chat, text=caption + "\n(кадр недоступен)",
                                 reply_markup=markup)
            except Exception as e:
                log("Не отправилось в", chat, e)

    def watch_events(self):
        watcher = EventWatcher(self.domru.events)
        markers = self.config["call_event_markers"]
        while True:
            try:
                for event in watcher.poll():
                    kind = event.get("eventTypeName", "?")
                    log("Событие:", kind, "|", event.get("message", ""))
                    if is_call_event(event, markers):
                        self.notify("🔔 Звонок в домофон")
                    elif self.config["notify_all_events"]:
                        self.notify(f"ℹ️ {kind}: {event.get('message', '')}", with_button=False)
            except Exception as e:
                log("Ошибка опроса событий:", e)
                time.sleep(15)
            time.sleep(self.config["poll_seconds"])

    # Telegram

    def handle(self, update):
        if "callback_query" in update:
            return self.handle_button(update["callback_query"])
        message = update.get("message") or {}
        chat = message.get("chat", {}).get("id")
        text = (message.get("text") or "").split("@")[0].strip()
        if chat is None or not text.startswith("/"):
            return
        if chat not in self.allowed:
            # Помогает узнать chat_id при настройке, больше ничего чужим не отвечаем
            if text == "/start":
                self.tg.call("sendMessage", chat_id=chat,
                             text=f"Твой chat_id: {chat}\nДобавь его в allowed_chat_ids в config.json.")
            log("Команда из чужого чата", chat, text)
            return
        if text in ("/start", "/help"):
            self.tg.call("sendMessage", chat_id=chat, text=(
                "Пришлю кадр и кнопку, когда позвонят в домофон.\n"
                "/photo — кадр с камеры сейчас\n"
                "/open — открыть дверь\n"
                "/events — последние события (для настройки)"))
        elif text in ("/photo", "/open"):
            self.send_photo_to(chat, "📷 Сейчас" if text == "/photo" else "Открыть дверь?")
        elif text == "/events":
            lines = [f"{e.get('timestamp', '')[:19]} {e.get('eventTypeName', '?')} {e.get('message', '')}"
                     for e in self.domru.events()[:10]]
            self.tg.call("sendMessage", chat_id=chat, text="\n".join(lines) or "Событий нет")

    def send_photo_to(self, chat, title):
        caption = f"{title}\n{self.door_title()} · {time.strftime('%H:%M:%S')}"
        try:
            self.tg.send_photo(chat, self.domru.snapshot(), caption, open_keyboard())
        except Exception as e:
            log("Кадр не получен:", e)
            self.tg.call("sendMessage", chat_id=chat, text=caption + "\n(кадр недоступен)",
                         reply_markup=open_keyboard())

    def handle_button(self, query):
        chat = query.get("message", {}).get("chat", {}).get("id")
        data = query.get("data", "")
        answer = lambda text: self.tg.call("answerCallbackQuery", callback_query_id=query["id"], text=text)
        if chat not in self.allowed:
            return answer("Нет доступа")
        if data == "photo":
            answer("Обновляю…")
            return self.send_photo_to(chat, "📷 Сейчас")
        if not data.startswith("open:"):
            return answer("")
        if button_expired(data, self.config["open_button_ttl"]):
            return answer("Кнопка устарела. Отправь /open")
        try:
            self.domru.open_door()
        except Exception as e:
            log("Не открылось:", e)
            return answer("Не получилось открыть 😕")
        who = query.get("from", {}).get("first_name", "")
        log("Дверь открыта:", who, chat)
        answer("Открыто ✅")
        message = query["message"]
        caption = (message.get("caption") or message.get("text") or "") + \
            f"\n✅ Открыто в {time.strftime('%H:%M:%S')}" + (f" ({who})" if who else "")
        method = "editMessageCaption" if "caption" in message else "editMessageText"
        field = "caption" if method == "editMessageCaption" else "text"
        try:
            self.tg.call(method, chat_id=chat, message_id=message["message_id"], **{field: caption})
        except Exception as e:
            log("Не обновилось сообщение:", e)

    def run(self, watch=True):
        if watch:
            threading.Thread(target=self.watch_events, daemon=True).start()
            log("Бот запущен. Дверь:", self.door_title(), "| чаты:", sorted(self.allowed))
        else:
            log("Режим настройки: напиши боту /start, он пришлёт твой chat_id")
        offset = 0
        while True:
            try:
                updates = self.tg.call("getUpdates", http_timeout=60, timeout=50, offset=offset,
                                       allowed_updates=["message", "callback_query"])
            except Exception as e:
                log("Ошибка Telegram:", e)
                time.sleep(5)
                continue
            for update in updates:
                offset = update["update_id"] + 1
                try:
                    self.handle(update)
                except Exception as e:
                    log("Ошибка обработки:", e)


# ---------- CLI ----------

def cmd_login(config):
    domru = DomRu(config, on_tokens=lambda: save_config(config))
    phone = input("Телефон в формате 79XXXXXXXXX: ").strip().lstrip("+")
    accounts = domru.accounts(phone)
    if not accounts:
        sys.exit("Аккаунтов на этот номер не найдено")
    for i, acc in enumerate(accounts):
        print(f"  {i}. {acc.get('address', '?')}")
    account = accounts[int(input("Номер адреса: ") or 0) if len(accounts) > 1 else 0]
    domru.request_sms(phone, account)
    code = input("Код из SMS: ").strip()
    config["phone"] = phone
    domru.confirm_sms(phone, account, code)
    print("Вход выполнен.")

    places = domru.places()
    doors = [(p, addr, d, name) for p, addr, ds in places for d, name in ds]
    if not doors:
        sys.exit("Дверей не найдено. Проверь в приложении, что домофон подключён.")
    for i, (_, addr, _, name) in enumerate(doors):
        print(f"  {i}. {name} — {addr}")
    idx = int(input("Какую дверь открывать кнопкой: ") or 0) if len(doors) > 1 else 0
    config["place_id"], _, config["access_control_id"], config["door_name"] = doors[idx]
    save_config(config)
    print(f"Сохранено в {CONFIG_PATH}. Дальше: python3 domofon_bot.py check")


def cmd_check(config):
    domru = DomRu(config, on_tokens=lambda: save_config(config))
    for place, addr, doors in domru.places():
        print(f"Адрес {place}: {addr}")
        for door, name in doors:
            mark = " ← выбрана" if (place, door) == (config["place_id"], config["access_control_id"]) else ""
            print(f"  дверь {door}: {name}{mark}")
    print("\nПоследние события:")
    for e in domru.events()[:10]:
        flag = "  ← звонок" if is_call_event(e, config["call_event_markers"]) else ""
        print(f"  {e.get('timestamp', '')[:19]}  {e.get('eventTypeName', '?')}  {e.get('message', '')}{flag}")
    path = os.path.join(os.path.dirname(CONFIG_PATH), "snapshot.jpg")
    with open(path, "wb") as f:
        f.write(domru.snapshot())
    print(f"\nКадр сохранён: {path}")


def cmd_run(config):
    if not config["telegram_token"]:
        sys.exit("Не заполнен telegram_token в config.json")
    domru = DomRu(config, on_tokens=lambda: save_config(config))
    bot = Bot(config, domru, Telegram(config["telegram_token"]))
    if not config["allowed_chat_ids"]:
        return bot.run(watch=False)
    missing = [k for k in ("access_token", "place_id", "access_control_id") if not config[k]]
    if missing:
        sys.exit("Не заполнено в config.json: " + ", ".join(missing) + ". Выполни: python3 domofon_bot.py login")
    bot.run()


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else "run"
    config = load_config()
    if not os.path.exists(CONFIG_PATH):
        save_config(config)
    commands = {"login": cmd_login, "check": cmd_check, "run": cmd_run}
    if command not in commands:
        sys.exit(__doc__)
    try:
        commands[command](config)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
