"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

const MINIMO = 8;

/** Lo que manda Supabase en el fragmento cuando el enlace ya no sirve. */
const MENSAJES: Record<string, string> = {
  otp_expired:
    "Este enlace ya venció o se usó. Los enlaces de invitación valen una sola vez.",
  access_denied: "Este enlace no es válido.",
};

type Estado = "verificando" | "listo" | "sin-sesion" | "guardando" | "hecho";

export function DefinirPasswordForm() {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>("verificando");
  const [errorDelEnlace, setErrorDelEnlace] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [repetida, setRepetida] = useState("");
  const [error, setError] = useState<string | null>(null);

  // react-hooks/set-state-in-effect: acá el efecto es el lugar correcto. Lo que
  // se lee es window.location.hash, que no existe durante el render del
  // servidor. Calcularlo en el primer render del cliente haría que el HTML
  // hidratado no coincida con el que mandó el servidor.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Supabase devuelve el resultado en el fragmento (#), que nunca llega al
    // servidor. Por eso esta pantalla resuelve todo del lado del cliente.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const codigo = hash.get("error_code") ?? hash.get("error");

    if (codigo) {
      setErrorDelEnlace(
        MENSAJES[codigo] ??
          hash.get("error_description")?.replace(/\+/g, " ") ??
          "Este enlace no es válido.",
      );
      setEstado("sin-sesion");
      return;
    }

    const supabase = createClient();
    let cancelado = false;

    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");

    if (accessToken && refreshToken) {
      // setSession explícito, y no confiar en que el cliente lea el fragmento
      // solo. `createBrowserClient` de @supabase/ssr usa flujo PKCE por defecto,
      // y en PKCE el cliente espera un `?code=` en la query: los tokens que
      // llegan en el `#` de una invitación los ignora por completo. La pantalla
      // mostraba "enlace vencido" con un token perfectamente válido en la URL.
      supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      }).then(({ error }) => {
        if (cancelado) return;
        if (error) {
          setErrorDelEnlace(error.message);
          setEstado("sin-sesion");
          return;
        }
        // El token sale de la barra de direcciones y del historial apenas se
        // canjeó. Mientras esté ahí, viaja en cada captura de pantalla, en cada
        // "compartir esta página" y en el historial del navegador.
        window.history.replaceState(null, "", window.location.pathname);
        setEstado("listo");
      });
      return;
    }

    // Sin tokens en la URL puede que igual haya sesión: por ejemplo si la
    // persona recargó la pantalla después de canjear el enlace.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelado) return;
      setEstado(data.session ? "listo" : "sin-sesion");
    });

    return () => {
      cancelado = true;
    };
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  async function guardar() {
    setError(null);

    if (password.length < MINIMO) {
      setError(`La contraseña tiene que tener al menos ${MINIMO} caracteres.`);
      return;
    }
    if (password !== repetida) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }

    setEstado("guardando");
    const supabase = createClient();
    const { error: fallo } = await supabase.auth.updateUser({ password });

    if (fallo) {
      setError(fallo.message);
      setEstado("listo");
      return;
    }

    setEstado("hecho");
    // refresh() además de push(): el layout del producto lee la sesión en el
    // servidor, y sin refrescar seguiría viendo la de antes.
    router.push("/overview");
    router.refresh();
  }

  if (estado === "verificando") {
    return (
      <div className="flex items-center gap-3 text-sm text-pand-gris">
        <Loader2 className="h-4 w-4 animate-spin" />
        Verificando el enlace…
      </div>
    );
  }

  if (estado === "sin-sesion") {
    return (
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Enlace vencido</h1>
        <p className="mt-3 text-sm text-pand-gris">
          {errorDelEnlace ??
            "No pudimos validar el enlace. Puede que ya se haya usado o que haya vencido."}
        </p>
        <p className="mt-4 text-sm text-pand-gris">
          Pedí uno nuevo desde{" "}
          <Link href="/forgot-password" className="font-semibold text-pand-azul hover:underline">
            recuperar contraseña
          </Link>
          , o pedile a quien te invitó que te mande otra invitación.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-extrabold tracking-tight">Definí tu contraseña</h1>
      <p className="mt-2 text-sm text-pand-gris">
        Con esta contraseña vas a entrar a Pand de ahora en más.
      </p>

      <div className="mt-8 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p className="text-xs text-pand-gris">Mínimo {MINIMO} caracteres.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="repetida">Repetila</Label>
          <Input
            id="repetida"
            type="password"
            autoComplete="new-password"
            value={repetida}
            onChange={(event) => setRepetida(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") guardar();
            }}
          />
        </div>

        {error && <p className="text-sm text-pand-coral">{error}</p>}

        <Button
          className="w-full"
          disabled={estado === "guardando" || estado === "hecho"}
          onClick={guardar}
        >
          {(estado === "guardando" || estado === "hecho") && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Guardar y entrar
        </Button>
      </div>
    </div>
  );
}
