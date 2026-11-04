"""Ejecuta el código de una práctica y, si se pide, su comprobación.

- Al ejecutar, input() lee las líneas de la casilla «Entradas» (una por línea) y sys.argv los «Argumentos».
- Al comprobar, el código no se ejecuta aquí: lo ejecuta la comprobación las veces que quiera, con
  curso.programa(entradas) (como el check50 de CS50) o curso.modulo() para probar funciones sueltas.
"""

import base64
import builtins
import json
import os
import re
import sys
import textwrap
import traceback
from pyodide.code import eval_code_async

import curso

PISTAS = {
    "SyntaxError": "Error de sintaxis: revisa paréntesis, comillas y los dos puntos (:) al final de def, if, for o while.",
    "IndentationError": "Error de sangría: lo que va dentro de def, if, for o while lleva 4 espacios más que la línea de arriba.",
    "TabError": "Mezclas tabuladores y espacios en la sangría: usa siempre 4 espacios.",
    "NameError": "Usas un nombre que no existe. ¿Está bien escrito? ¿Lo has definido (o importado) antes de usarlo?",
    "TypeError": "Tipo incorrecto: revisa los argumentos que pasas a la función, o si estás mezclando texto (str) y números (int, float).",
    "ValueError": "El valor no tiene la forma esperada: por ejemplo, int('hola') o float('') fallan.",
    "KeyError": "Esa clave no está en el diccionario. Revisa cómo se llama exactamente.",
    "AttributeError": "Ese objeto no tiene ese atributo o método. ¿Está bien escrito? ¿Es del tipo que crees?",
    "IndexError": "Te sales de la lista o de la cadena: pides una posición que no existe.",
    "ZeroDivisionError": "Divides entre cero.",
    "ModuleNotFoundError": "Esa librería no está disponible sin conexión. Mira la lista de librerías en la Zona libre.",
    "ImportError": "No se puede importar eso. Mira la lista de librerías disponibles en la Zona libre.",
    "EOFError": "Tu programa pide más datos con input() de los que hay. Al ejecutar, revisa «Entradas»: un valor por línea. Si el programa debe terminar con Control-D, atrapa EOFError.",
    "RecursionError": "Una función se llama a sí misma sin fin.",
    "UnboundLocalError": "Usas una variable dentro de la función antes de darle valor.",
    "FileNotFoundError": "No existe ese archivo. Revisa el nombre.",
}

ARCHIVOS = {"tu_codigo.py": "tu código", "comprobacion.py": "la comprobación"}

_input_real = builtins.input


def _formatear(exc):
    nombre = type(exc).__name__
    marcos = [m for m in traceback.extract_tb(exc.__traceback__) if m.filename in ARCHIVOS or m.filename.startswith("/tmp/ejecucion_")]
    linea, archivo = None, None
    if marcos:
        # la última línea que es de tu código (si la hay) es la más útil
        propios = [m for m in marcos if m.filename != "comprobacion.py"]
        m = (propios or marcos)[-1]
        linea, archivo = m.lineno, m.filename
    if isinstance(exc, SyntaxError) and exc.filename in ARCHIVOS:
        linea, archivo = exc.lineno, exc.filename
    texto = "".join(traceback.format_exception_only(type(exc), exc))
    # la línea 'File "tu_codigo.py", line N' sobra: ya se indica la línea aparte
    texto = textwrap.dedent("\n".join(l for l in texto.splitlines() if not l.strip().startswith('File "'))).strip()
    donde = ARCHIVOS.get(archivo, os.path.basename(archivo) if archivo else "")
    return {"type": nombre, "msg": texto, "line": linea, "where": donde, "hint": PISTAS.get(nombre, "")}


def _input_con(entradas):
    """input() que lee de la lista de entradas y escribe el valor, como si se tecleara en la terminal."""
    cola = list(entradas or [])

    def leer(prompt=""):
        print(prompt, end="")
        if not cola:
            print()
            if entradas is None:
                raise EOFError("input() necesita datos: activa «Entradas» y escribe un valor por línea.")
            raise EOFError("No hay más entradas: tu programa pide más valores de los que has escrito en «Entradas» (es como pulsar Control-D en la terminal).")
        valor = cola.pop(0)
        print(valor)
        return valor

    return leer


async def ejecutar(code, tests=None, entradas=None, argv=None, ficheros=None):
    curso._reset_checks()
    curso._codigo = code
    ficheros = json.loads(ficheros) if isinstance(ficheros, str) and ficheros else {}
    if not isinstance(tests, str):
        return await _ejecutar(code, None if entradas is None else list(entradas), list(argv or []), ficheros)
    return _comprobar(code, tests, ficheros)


MARCA = re.compile(r"^# === ([\w.-]+\.\w+) ===[ \t]*$", re.M)
_n = 0
IMAGENES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".pdf": "application/pdf"}


def _carpeta_nueva(ficheros):
    """Crea una carpeta de trabajo vacía con los archivos del ejercicio y entra en ella."""
    global _n
    _n += 1
    carpeta = f"/tmp/ejecucion_{_n}"
    os.makedirs(carpeta, exist_ok=True)
    for nombre, dato in (ficheros or {}).items():
        ruta = os.path.join(carpeta, nombre)
        os.makedirs(os.path.dirname(ruta), exist_ok=True)
        if "b" in dato:
            with open(ruta, "wb") as f:
                f.write(base64.b64decode(dato["b"]))
        else:
            with open(ruta, "w") as f:
                f.write(dato["t"])
    os.chdir(carpeta)
    sys.path.insert(0, carpeta)
    return carpeta


def _foto(carpeta):
    out = {}
    for raiz, _, nombres in os.walk(carpeta):
        for n in nombres:
            ruta = os.path.join(raiz, n)
            st = os.stat(ruta)
            out[os.path.relpath(ruta, carpeta)] = (st.st_size, st.st_mtime_ns)
    return out


def _nuevos(carpeta, antes):
    """Archivos creados o cambiados durante la ejecución, para mostrarlos en la app."""
    res = []
    for nombre, firma in sorted(_foto(carpeta).items()):
        if antes.get(nombre) == firma or nombre.startswith("__pycache__") or nombre.endswith(".pyc") or len(res) >= 4:
            continue
        ruta = os.path.join(carpeta, nombre)
        ext = os.path.splitext(nombre)[1].lower()
        if ext in IMAGENES and firma[0] < 3_000_000:
            with open(ruta, "rb") as f:
                res.append({"name": nombre, "mime": IMAGENES[ext], "b64": base64.b64encode(f.read()).decode()})
        elif firma[0] < 200_000:
            try:
                with open(ruta, encoding="utf-8") as f:
                    res.append({"name": nombre, "text": f.read()[:6000]})
            except UnicodeDecodeError:
                res.append({"name": nombre, "text": f"(archivo binario de {firma[0]} bytes)"})
    return res


def _varios(code, carpeta):
    """Código con varios archivos («# === nombre.py ===»): se escriben en la carpeta de trabajo. Si hay archivos
    test_*.py, se ejecuta pytest con ellos; si no, se ejecuta el primer archivo .py como programa."""
    marcas = list(MARCA.finditer(code))
    ficheros = {}
    for i, m in enumerate(marcas):
        fin = marcas[i + 1].start() if i + 1 < len(marcas) else len(code)
        ficheros[m.group(1)] = code[m.end():fin].strip("\n") + "\n"
    for nombre, texto in ficheros.items():
        with open(os.path.join(carpeta, nombre), "w") as f:
            f.write(texto)
        sys.modules.pop(nombre[:-3], None)
    pruebas = [n for n in ficheros if n.startswith("test_") and n.endswith(".py")]
    if pruebas:
        import pytest
        print("$ pytest " + " ".join(pruebas))
        codigo = pytest.main(["-q", "-p", "no:cacheprovider", *pruebas])
        return {"ok": True, "phase": "code", "value": None, "pytest": int(codigo)}
    programas = [n for n in ficheros if n.endswith(".py")]
    if programas:
        exec(compile(ficheros[programas[0]], os.path.join(carpeta, programas[0]), "exec"), {"__name__": "__main__"})
    return {"ok": True, "phase": "code", "value": None}


async def _ejecutar(code, entradas, argv, ficheros):
    ns = {"__name__": "__main__"}
    valor = None
    builtins.input = _input_con(entradas)
    sys.argv = ["tu_codigo.py", *argv]
    dir_inicial = os.getcwd()
    path_inicial = list(sys.path)
    carpeta = None
    antes = {}
    try:
        # cada ejecución, en una carpeta nueva con los archivos del ejercicio
        carpeta = _carpeta_nueva(ficheros)
        antes = _foto(carpeta)
        if MARCA.search(code):
            res = _varios(code, carpeta)
            res["files"] = _nuevos(carpeta, antes)
            return res
        res = await eval_code_async(code, ns, filename="tu_codigo.py")
        if res is not None:
            valor = repr(res)[:4000]
    except SystemExit as e:
        if e.code not in (None, 0):
            if isinstance(e.code, int):
                print(f"(el programa termina con el código {e.code})", file=sys.stderr)
            else:
                print(e.code, file=sys.stderr)
        return {"ok": True, "phase": "code", "exit": True, "files": _nuevos(carpeta, antes) if carpeta else []}
    except BaseException as e:  # noqa: BLE001 - mostramos cualquier error al alumno
        return {"ok": False, "phase": "code", "error": _formatear(e), "files": _nuevos(carpeta, antes) if carpeta else []}
    finally:
        builtins.input = _input_real
        sys.argv = ["tu_codigo.py"]
        os.chdir(dir_inicial)
        sys.path[:] = path_inicial
    return {"ok": True, "phase": "code", "value": valor, "files": _nuevos(carpeta, antes) if carpeta else []}


def _comprobar(code, tests, ficheros):
    try:
        compile(code, "tu_codigo.py", "exec")
    except SyntaxError as e:
        if not MARCA.search(code):
            return {"ok": False, "phase": "code", "error": _formatear(e)}
    ns = {"__name__": "comprobacion"}
    dir_inicial = os.getcwd()
    path_inicial = list(sys.path)
    _carpeta_nueva(ficheros)
    try:
        exec(compile(tests, "comprobacion.py", "exec"), ns)
    except AssertionError as e:
        return {"ok": False, "phase": "tests", "failed": str(e), "passed": list(curso._checks)}
    except AttributeError as e:
        if getattr(getattr(e, "obj", None), "__name__", "") == "tu_codigo":
            return {"ok": False, "phase": "tests", "passed": list(curso._checks),
                    "failed": f"No encuentro «{e.name}» en tu código. ¿Has cambiado el nombre o lo has borrado?"}
        return {"ok": False, "phase": "tests", "error": _formatear(e), "passed": list(curso._checks)}
    except BaseException as e:  # noqa: BLE001
        return {"ok": False, "phase": "tests", "error": _formatear(e), "passed": list(curso._checks)}
    finally:
        builtins.input = _input_real
        sys.argv = ["tu_codigo.py"]
        os.chdir(dir_inicial)
        sys.path[:] = path_inicial
    return {"ok": True, "phase": "tests", "passed": list(curso._checks)}
