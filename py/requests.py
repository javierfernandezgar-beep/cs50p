"""requests simulado: la app funciona sin conexión, así que no hay internet de verdad.

Imita lo básico de la librería requests (get, Response.json, status_code, raise_for_status,
RequestException) y responde con datos guardados a las direcciones que usa el curso:

- CoinCap (problema Bitcoin): rest.coincap.io/v3/assets/bitcoin y api.coincap.io/v2/assets/bitcoin.
  Precio fijo: 97845.0243474572557500 dólares.
- iTunes (clase 4): itunes.apple.com/search?...&term=weezer

Cualquier otra dirección lanza requests.ConnectionError.
"""

import json as _json
from urllib.parse import urlparse, parse_qs

__version__ = "simulada"

BITCOIN = {
    "data": {
        "id": "bitcoin", "rank": "1", "symbol": "BTC", "name": "Bitcoin",
        "supply": "19823321.0000000000000000", "maxSupply": "21000000.0000000000000000",
        "marketCapUsd": "1939613325892.4607145113457500", "volumeUsd24Hr": "12341417371.3505338276601668",
        "priceUsd": "97845.0243474572557500", "changePercent24Hr": "1.4324165997531723",
        "vwap24Hr": "96203.8859537212418977", "explorer": "https://blockchain.info/",
    },
    "timestamp": 1739399343596,
}

WEEZER = ["Buddy Holly", "Say It Ain't So", "Island In the Sun", "Beverly Hills", "Hash Pipe",
          "Undone - The Sweater Song", "My Name Is Jonas", "Africa", "Pork and Beans", "El Scorcho"]


class RequestException(IOError):
    pass


class ConnectionError(RequestException):
    pass


class HTTPError(RequestException):
    pass


class Timeout(RequestException):
    pass


class Response:
    def __init__(self, url, status_code, data):
        self.url = url
        self.status_code = status_code
        self._data = data
        self.ok = status_code < 400
        self.text = _json.dumps(data)
        self.content = self.text.encode()

    def json(self):
        return _json.loads(self.text)

    def raise_for_status(self):
        if not self.ok:
            raise HTTPError(f"{self.status_code} Error for url: {self.url}")


def _itunes(query):
    term = (query.get("term") or [""])[0].lower()
    limit = int((query.get("limit") or ["50"])[0])
    songs = WEEZER if "weezer" in term else []
    results = [{"wrapperType": "track", "kind": "song", "artistName": "Weezer", "trackName": t} for t in songs[:limit]]
    return {"resultCount": len(results), "results": results}


def get(url, params=None, **kwargs):
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    u = urlparse(url)
    query = parse_qs(u.query)
    for k, v in (params or {}).items():
        query[k] = [str(v)]
    if u.netloc in ("rest.coincap.io", "api.coincap.io") and u.path.rstrip("/").endswith("/assets/bitcoin"):
        return Response(url, 200, BITCOIN)
    if u.netloc == "itunes.apple.com" and u.path.startswith("/search"):
        return Response(url, 200, _itunes(query))
    raise ConnectionError(f"Sin conexión: esta app no tiene internet. requests está simulada y solo responde a CoinCap (Bitcoin) y a la búsqueda de iTunes de la clase 4. Dirección pedida: {url}")
