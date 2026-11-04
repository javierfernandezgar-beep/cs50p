"""Ejecuta el código de una práctica y, si se pide, su comprobación.

- Al ejecutar, input() lee las líneas de la casilla «Entradas» (una por línea) y sys.argv los «Argumentos».
- Al comprobar, el código no se ejecuta aquí: lo ejecuta la comprobación las veces que quiera, con
  curso.programa(entradas) (como el check50 de CS50) o curso.modulo() para probar funciones sueltas.
"""

import builtins
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
    "EOFError": "Tu programa ha pedido más datos con input() de los que hay. Activa «Entradas» y escribe un valor por línea.",
    "RecursionError": "Una función se llama a sí misma sin fin.",
    "UnboundLocalError": "Usas una variable dentro de la función antes de darle valor.",
    "FileNotFoundError": "No existe ese archivo. Revisa el nombre.",
}

ARCHIVOS = {"tu_codigo.py": "tu código", "comprobacion.py": "la comprobación"}

_input_real = builtins.input


def _formatear(exc):
    nombre = type(exc).__name__
    marcos = [m for m in traceback.extract_tb(exc.__traceback__) if m.filename in ARCHIVOS]
    linea, archivo = None, None
    if marcos:
        # la última línea que es de tu código (si la hay) es la más útil
        propios = [m for m in marcos if m.filename == "tu_codigo.py"]
        m = (propios or marcos)[-1]
        linea, archivo = m.lineno, m.filename
    if isinstance(exc, SyntaxError) and exc.filename in ARCHIVOS:
        linea, archivo = exc.lineno, exc.filename
    texto = "".join(traceback.format_exception_only(type(exc), exc))
    # la línea 'File "tu_codigo.py", line N' sobra: ya se indica la línea aparte
    texto = textwrap.dedent("\n".join(l for l in texto.splitlines() if not l.strip().startswith('File "'))).strip()
    return {"type": nombre, "msg": texto, "line": linea, "where": ARCHIVOS.get(archivo, ""), "hint": PISTAS.get(nombre, "")}


def _input_con(entradas):
    """input() que lee de la lista de entradas y escribe el valor, como si se tecleara en la terminal."""
    cola = list(entradas or [])

    def leer(prompt=""):
        print(prompt, end="")
        if not cola:
            print()
            if entradas is None:
                raise EOFError("input() necesita datos: activa «Entradas» y escribe un valor por línea.")
            raise EOFError("Faltan entradas: tu programa pide más valores de los que has escrito en «Entradas».")
        valor = cola.pop(0)
        print(valor)
        return valor

    return leer


async def ejecutar(code, tests=None, entradas=None, argv=None):
    curso._reset_checks()
    curso._codigo = code
    if not isinstance(tests, str):
        return await _ejecutar(code, None if entradas is None else list(entradas), list(argv or []))
    return _comprobar(code, tests)


async def _ejecutar(code, entradas, argv):
    ns = {"__name__": "__main__"}
    valor = None
    builtins.input = _input_con(entradas)
    sys.argv = ["tu_codigo.py", *argv]
    try:
        res = await eval_code_async(code, ns, filename="tu_codigo.py")
        if res is not None:
            valor = repr(res)[:4000]
    except SystemExit as e:
        if e.code not in (None, 0):
            if isinstance(e.code, int):
                print(f"(el programa termina con el código {e.code})", file=sys.stderr)
            else:
                print(e.code, file=sys.stderr)
        return {"ok": True, "phase": "code", "exit": True}
    except BaseException as e:  # noqa: BLE001 - mostramos cualquier error al alumno
        return {"ok": False, "phase": "code", "error": _formatear(e)}
    finally:
        builtins.input = _input_real
        sys.argv = ["tu_codigo.py"]
    return {"ok": True, "phase": "code", "value": valor}


def _comprobar(code, tests):
    try:
        compile(code, "tu_codigo.py", "exec")
    except SyntaxError as e:
        return {"ok": False, "phase": "code", "error": _formatear(e)}
    ns = {"__name__": "comprobacion"}
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
    return {"ok": True, "phase": "tests", "passed": list(curso._checks)}
