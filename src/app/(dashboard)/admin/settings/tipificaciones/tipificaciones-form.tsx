"use client";

import { Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { ActionResult, ActionType } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { saveTipificaciones } from "@/lib/config/actions";
import {
  MAX_RESULTADOS_PROPIOS,
  MAX_TIPOS_PROPIOS,
  slugDeTipificacion,
  type Tipificaciones,
} from "@/lib/config/settings";
import { ACTION_RESULT_LABELS, ACTION_TYPE_LABELS } from "@/lib/tasks/action-config";
import { cn } from "@/lib/utils";

/**
 * Las tipificaciones de la organización: las de fábrica y las propias.
 *
 * Las de fábrica se renombran y se apagan, pero no se borran: hay gestiones
 * cargadas que apuntan a ellas y los reportes de promesas y contactabilidad
 * salen de su significado. Las propias se crean, se editan y se borran.
 *
 * Toda tipificación propia declara de cuál de fábrica hereda el significado.
 * Es lo que permite que la organización escriba su propio vocabulario sin que el
 * producto pierda la capacidad de saber qué significa "prometió pagar".
 */

/** Lo que el formulario tiene en pantalla, antes de guardarse. */
type EstadoTipo = {
  label: string;
  activo: boolean;
  /** Códigos de resultado tildados. */
  resultados: string[];
};

type PropioTipo = EstadoTipo & { id: string; base: ActionType };
type PropioResultado = { id: string; label: string; base: ActionResult };

type Estado = {
  /** Las de fábrica, por su enum. */
  tipos: Record<string, EstadoTipo>;
  etiquetasResultado: Record<string, string>;
  tiposPropios: PropioTipo[];
  resultadosPropios: PropioResultado[];
};

const TIPOS_BASE = Object.keys(ACTION_TYPE_LABELS) as ActionType[];
const RESULTADOS_BASE = Object.keys(ACTION_RESULT_LABELS) as ActionResult[];

function desdeConfig(config: Tipificaciones): Estado {
  const propios = config.tipos.filter((t) => t.propia);

  return {
    tipos: Object.fromEntries(
      config.tipos
        .filter((t) => !t.propia)
        .map((t) => [
          t.tipo,
          { label: t.label, activo: t.activo, resultados: [...t.resultados] },
        ]),
    ),
    etiquetasResultado: Object.fromEntries(
      config.resultados.filter((r) => !r.propia).map((r) => [r.codigo, r.label]),
    ),
    tiposPropios: propios.map((t) => ({
      id: t.tipo,
      base: t.base,
      label: t.label,
      activo: t.activo,
      resultados: [...t.resultados],
    })),
    resultadosPropios: config.resultados
      .filter((r) => r.propia)
      .map((r) => ({ id: r.codigo, label: r.label, base: r.base })),
  };
}

export function TipificacionesForm({
  config,
  permitidos,
  basesManuales,
}: {
  config: Tipificaciones;
  /** Qué resultados de fábrica admite cada tipo de fábrica, como máximo. */
  permitidos: Record<ActionType, ActionResult[]>;
  /** Los tipos de los que puede heredar una tipificación propia. */
  basesManuales: ActionType[];
}) {
  const [estado, setEstado] = useState<Estado>(() => desdeConfig(config));
  /**
   * Las tipificaciones creadas en esta pantalla y todavía no guardadas.
   *
   * Importa porque su id se recalcula al guardar, cuando ya tienen el nombre
   * definitivo. Las que vienen de la base no se tocan nunca: su id ya está
   * escrito en gestiones y cambiarlo las dejaría huérfanas.
   */
  const [nuevas, setNuevas] = useState<Set<string>>(() => new Set());
  const [saving, startSaving] = useTransition();

  /**
   * Los resultados que se pueden ofrecer para un tipo con esta base: los de
   * fábrica que la base admite, más los propios que heredan de uno de ellos.
   *
   * Se calcula acá y no se pide al servidor porque tiene que reaccionar mientras
   * se escribe: si alguien agrega el resultado "Habló la esposa" heredando de
   * CALLBACK, tiene que aparecer como opción de los tipos que admiten CALLBACK
   * sin recargar la página.
   */
  function opcionesPara(base: ActionType): { codigo: string; label: string }[] {
    const bases = permitidos[base] ?? [];

    return [
      ...bases.map((r) => ({
        codigo: r,
        label: estado.etiquetasResultado[r] ?? ACTION_RESULT_LABELS[r],
      })),
      ...estado.resultadosPropios
        .filter((r) => bases.includes(r.base))
        .map((r) => ({ codigo: r.id, label: r.label })),
    ];
  }

  function setTipo(tipo: string, cambio: Partial<EstadoTipo>) {
    setEstado((actual) => ({
      ...actual,
      tipos: { ...actual.tipos, [tipo]: { ...actual.tipos[tipo], ...cambio } },
    }));
  }

  function setPropio(id: string, cambio: Partial<PropioTipo>) {
    setEstado((actual) => ({
      ...actual,
      tiposPropios: actual.tiposPropios.map((t) =>
        t.id === id ? { ...t, ...cambio } : t,
      ),
    }));
  }

  /** Tilda o destilda un resultado para un tipo, propio o de fábrica. */
  function toggleResultado(tipo: string, codigo: string, propia: boolean) {
    const actuales = propia
      ? (estado.tiposPropios.find((t) => t.id === tipo)?.resultados ?? [])
      : estado.tipos[tipo].resultados;

    const siguientes = actuales.includes(codigo)
      ? actuales.filter((r) => r !== codigo)
      : [...actuales, codigo];

    if (propia) setPropio(tipo, { resultados: siguientes });
    else setTipo(tipo, { resultados: siguientes });
  }

  /**
   * Un id libre a partir del nombre.
   *
   * El id sale del nombre y no de un contador porque es lo que se guarda en cada
   * gestión: si la organización borra la tipificación, el historial igual puede
   * mostrar "Carta documento" leyendo `carta_documento`. Un `tipo_7` no diría nada.
   */
  function idLibre(label: string, tomados: string[]): string {
    const base = slugDeTipificacion(label);
    if (!tomados.includes(base)) return base;

    for (let i = 2; i < 100; i += 1) {
      const candidato = `${base}_${i}`.slice(0, 40);
      if (!tomados.includes(candidato)) return candidato;
    }
    return `${base}_${Date.now()}`.slice(0, 40);
  }

  function agregarTipo() {
    setEstado((actual) => {
      if (actual.tiposPropios.length >= MAX_TIPOS_PROPIOS) return actual;

      const base = basesManuales[0] ?? "CALL";
      const label = "Nueva gestión";
      const id = idLibre(label, actual.tiposPropios.map((t) => t.id));
      setNuevas((previas) => new Set(previas).add(id));

      return {
        ...actual,
        tiposPropios: [
          ...actual.tiposPropios,
          {
            id,
            base,
            label,
            activo: true,
            // Arranca con todos los resultados que la base admite. Arrancar vacío
            // dejaría el tipo apagado de entrada y parecería que no se guardó.
            resultados: (permitidos[base] ?? []).map((r) => r),
          },
        ],
      };
    });
  }

  function agregarResultado() {
    setEstado((actual) => {
      if (actual.resultadosPropios.length >= MAX_RESULTADOS_PROPIOS) return actual;

      const label = "Nuevo resultado";
      const id = idLibre(label, actual.resultadosPropios.map((r) => r.id));
      setNuevas((previas) => new Set(previas).add(id));

      return {
        ...actual,
        resultadosPropios: [
          ...actual.resultadosPropios,
          { id, label, base: "NO_ANSWER" },
        ],
      };
    });
  }

  function olvidarNueva(id: string) {
    setNuevas((previas) => {
      if (!previas.has(id)) return previas;
      const siguiente = new Set(previas);
      siguiente.delete(id);
      return siguiente;
    });
  }

  function borrarTipo(id: string) {
    olvidarNueva(id);
    setEstado((actual) => ({
      ...actual,
      tiposPropios: actual.tiposPropios.filter((t) => t.id !== id),
    }));
  }

  function borrarResultado(id: string) {
    olvidarNueva(id);
    setEstado((actual) => ({
      ...actual,
      resultadosPropios: actual.resultadosPropios.filter((r) => r.id !== id),
      // Y se saca de todos los tipos que lo ofrecían: dejarlo tildado guardaría
      // un código que ya no existe y el servidor lo descartaría en silencio.
      tipos: Object.fromEntries(
        Object.entries(actual.tipos).map(([tipo, valor]) => [
          tipo,
          { ...valor, resultados: valor.resultados.filter((r) => r !== id) },
        ]),
      ),
      tiposPropios: actual.tiposPropios.map((t) => ({
        ...t,
        resultados: t.resultados.filter((r) => r !== id),
      })),
    }));
  }

  function restaurar() {
    setEstado({
      tipos: Object.fromEntries(
        TIPOS_BASE.map((tipo) => [
          tipo,
          {
            label: ACTION_TYPE_LABELS[tipo],
            activo: true,
            resultados: [...(permitidos[tipo] ?? [])],
          },
        ]),
      ),
      etiquetasResultado: { ...ACTION_RESULT_LABELS },
      // Volver a fábrica borra lo propio: es lo que significa "de fábrica". El
      // botón pide confirmación justamente por esto.
      tiposPropios: [],
      resultadosPropios: [],
    });
    setNuevas(new Set());
  }

  /**
   * Les pone el id definitivo a las tipificaciones recién creadas.
   *
   * Al agregarlas el nombre todavía era el provisorio —"Nuevo resultado"—, y de
   * ahí había salido el id. Pero el id es lo que queda escrito en cada gestión:
   * si mañana se borra la tipificación, el historial lo lee para reconstruir el
   * nombre. Con el id provisorio, una gestión de "Acordó refinanciar" se leería
   * "Nuevo resultado" para siempre.
   *
   * Solo las nuevas. Una ya guardada conserva su id aunque se la renombre: ese id
   * está en gestiones de la base y cambiarlo las dejaría apuntando a la nada.
   */
  function conIdsDefinitivos(): Estado {
    if (nuevas.size === 0) return estado;

    const renombresResultado = new Map<string, string>();

    const tomadosRes = estado.resultadosPropios
      .filter((r) => !nuevas.has(r.id))
      .map((r) => r.id);

    const resultadosPropios = estado.resultadosPropios.map((r) => {
      if (!nuevas.has(r.id)) return r;
      const id = idLibre(r.label, tomadosRes);
      tomadosRes.push(id);
      if (id !== r.id) renombresResultado.set(r.id, id);
      return { ...r, id };
    });

    const tomadosTipos = estado.tiposPropios
      .filter((t) => !nuevas.has(t.id))
      .map((t) => t.id);

    const tiposPropios = estado.tiposPropios.map((t) => {
      if (!nuevas.has(t.id)) return t;
      const id = idLibre(t.label, tomadosTipos);
      tomadosTipos.push(id);
      return { ...t, id };
    });

    // Los tipos guardan el código de cada resultado que ofrecen, así que los que
    // apuntaban al id provisorio hay que traducirlos. Sin esto, el servidor
    // descartaría esas referencias y el resultado nuevo quedaría creado pero sin
    // aparecer en ningún tipo.
    const traducir = (codigos: string[]) =>
      codigos.map((c) => renombresResultado.get(c) ?? c);

    return {
      etiquetasResultado: estado.etiquetasResultado,
      resultadosPropios,
      tipos: Object.fromEntries(
        Object.entries(estado.tipos).map(([tipo, valor]) => [
          tipo,
          { ...valor, resultados: traducir(valor.resultados) },
        ]),
      ),
      tiposPropios: tiposPropios.map((t) => ({
        ...t,
        resultados: traducir(t.resultados),
      })),
    };
  }

  function guardar() {
    const estadoAGuardar = conIdsDefinitivos();

    startSaving(async () => {
      const outcome = await saveTipificaciones({
        tipificaciones: {
          tipos: Object.fromEntries(
            Object.entries(estadoAGuardar.tipos).map(([tipo, valor]) => [
              tipo,
              {
                label: valor.label.trim(),
                activo: valor.activo,
                resultados: valor.resultados,
              },
            ]),
          ),
          etiquetasResultado: Object.fromEntries(
            Object.entries(estadoAGuardar.etiquetasResultado).map(([r, label]) => [
              r,
              label.trim(),
            ]),
          ),
          tiposPropios: estadoAGuardar.tiposPropios.map((t) => ({
            id: t.id,
            label: t.label.trim(),
            base: t.base,
            activo: t.activo,
            resultados: t.resultados,
          })),
          resultadosPropios: estadoAGuardar.resultadosPropios.map((r) => ({
            id: r.id,
            label: r.label.trim(),
            base: r.base,
          })),
        },
      });

      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }

      // Lo guardado pasa a ser lo existente: a partir de acá estos ids ya están
      // en la base y no se vuelven a recalcular.
      setEstado(estadoAGuardar);
      setNuevas(new Set());
      toast.success("Tipificaciones guardadas.");
    });
  }

  const manuales = config.tipos.filter((t) => !t.propia && t.manual);
  const delSistema = config.tipos.filter((t) => !t.propia && !t.manual);

  const sinNombre =
    estado.tiposPropios.some((t) => !t.label.trim()) ||
    estado.resultadosPropios.some((r) => !r.label.trim()) ||
    Object.values(estado.tipos).some((t) => !t.label.trim()) ||
    Object.values(estado.etiquetasResultado).some((l) => !l.trim());

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-bold">Tipificaciones</h2>
        <p className="mt-1 text-sm text-pand-gris">
          Cómo llama tu equipo a cada gestión y a cada resultado, y qué resultados
          se ofrecen al cargar cada tipo.
        </p>
      </header>

      <p className="rounded-card border border-pand-border bg-pand-bg p-4 text-sm text-pand-gris">
        Podés crear las tipificaciones que necesites. Cada una declara{" "}
        <strong>de qué tipificación de fábrica hereda el significado</strong>, y eso
        es lo que mantiene vivos los reportes: Pand necesita saber cuál de los
        resultados significa <strong>prometió pagar</strong> para armar el reporte
        de promesas, y cuáles significan que{" "}
        <strong>no había nadie del otro lado</strong> para medir contactabilidad.
        Así podés llamar <em>&ldquo;Acordó refinanciar&rdquo;</em> a una promesa sin
        que el reporte de promesas deje de contarla.
      </p>

      {/* ── Resultados ──────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Resultados</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={agregarResultado}
            disabled={estado.resultadosPropios.length >= MAX_RESULTADOS_PROPIOS}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Agregar resultado
          </Button>
        </div>

        <div className="space-y-3 rounded-card bg-white p-5 shadow-panel">
          <p className="etiqueta">De fábrica · solo se renombran</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {RESULTADOS_BASE.map((resultado) => (
              <div key={resultado} className="space-y-1">
                <label
                  htmlFor={`res-${resultado}`}
                  className="mono block text-[11px] text-pand-gris"
                >
                  {resultado}
                </label>
                <Input
                  id={`res-${resultado}`}
                  value={estado.etiquetasResultado[resultado] ?? ""}
                  maxLength={40}
                  onChange={(event) =>
                    setEstado((actual) => ({
                      ...actual,
                      etiquetasResultado: {
                        ...actual.etiquetasResultado,
                        [resultado]: event.target.value,
                      },
                    }))
                  }
                  className="h-9"
                />
              </div>
            ))}
          </div>

          {estado.resultadosPropios.length > 0 && (
            <div className="border-t border-pand-border pt-4">
              <p className="etiqueta">Tuyos · se editan y se borran</p>
              <div className="mt-2 space-y-2">
                {estado.resultadosPropios.map((resultado) => (
                  <div
                    key={resultado.id}
                    className="flex flex-wrap items-end gap-3 rounded-md border border-pand-border p-3"
                  >
                    <div className="min-w-[200px] flex-1 space-y-1">
                      <label
                        htmlFor={`propio-${resultado.id}`}
                        className="block text-[11px] text-pand-gris"
                      >
                        Nombre
                      </label>
                      <Input
                        id={`propio-${resultado.id}`}
                        value={resultado.label}
                        maxLength={40}
                        onChange={(event) =>
                          setEstado((actual) => ({
                            ...actual,
                            resultadosPropios: actual.resultadosPropios.map((r) =>
                              r.id === resultado.id
                                ? { ...r, label: event.target.value }
                                : r,
                            ),
                          }))
                        }
                        className="h-9"
                      />
                    </div>

                    <div className="min-w-[200px] space-y-1">
                      <label
                        htmlFor={`base-${resultado.id}`}
                        className="block text-[11px] text-pand-gris"
                      >
                        Cuenta como
                      </label>
                      <NativeSelect
                        id={`base-${resultado.id}`}
                        value={resultado.base}
                        onChange={(event) =>
                          setEstado((actual) => ({
                            ...actual,
                            resultadosPropios: actual.resultadosPropios.map((r) =>
                              r.id === resultado.id
                                ? { ...r, base: event.target.value as ActionResult }
                                : r,
                            ),
                          }))
                        }
                        className="h-9"
                      >
                        {RESULTADOS_BASE.map((base) => (
                          <option key={base} value={base}>
                            {estado.etiquetasResultado[base] ??
                              ACTION_RESULT_LABELS[base]}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Borrar ${resultado.label}`}
                      onClick={() => borrarResultado(resultado.id)}
                      className="h-9 text-pand-coral hover:bg-pand-coral/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <p className="mt-2 text-xs text-pand-gris">
                Las gestiones ya cargadas con un resultado que borres siguen
                contándose por lo que significaba, y en la ficha del deudor se
                muestran con el nombre que tenía.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ── Tipos ───────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Tipos que carga el operador</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={agregarTipo}
            disabled={estado.tiposPropios.length >= MAX_TIPOS_PROPIOS}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Agregar tipo
          </Button>
        </div>

        {manuales.map((tipo) => {
          const valor = estado.tipos[tipo.tipo];
          if (!valor) return null;
          const opciones = opcionesPara(tipo.base);

          return (
            <div
              key={tipo.tipo}
              className={cn(
                "rounded-card bg-white p-5 shadow-panel transition-opacity",
                !valor.activo && "opacity-60",
              )}
            >
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={valor.activo}
                    onChange={(event) =>
                      setTipo(tipo.tipo, { activo: event.target.checked })
                    }
                    className="h-4 w-4 rounded border-pand-border"
                  />
                  <span className="text-sm font-semibold">Activo</span>
                </label>

                <Input
                  aria-label={`Nombre de ${ACTION_TYPE_LABELS[tipo.base]}`}
                  value={valor.label}
                  maxLength={40}
                  onChange={(event) =>
                    setTipo(tipo.tipo, { label: event.target.value })
                  }
                  className="h-9 w-[220px]"
                />

                <span className="mono text-xs text-pand-gris">{tipo.tipo}</span>
              </div>

              {opciones.length > 0 && (
                <ResultadosDelTipo
                  opciones={opciones}
                  elegidos={valor.resultados}
                  activo={valor.activo}
                  onToggle={(codigo) => toggleResultado(tipo.tipo, codigo, false)}
                />
              )}

              {tipo.base === "NOTE" && (
                <p className="mt-3 text-xs text-pand-gris">
                  Una nota es una anotación, no un intento de contacto: no lleva
                  resultado y no cuenta para la contactabilidad.
                </p>
              )}
            </div>
          );
        })}

        {estado.tiposPropios.map((tipo) => {
          const opciones = opcionesPara(tipo.base);

          return (
            <div
              key={tipo.id}
              className={cn(
                "rounded-card border-l-[3px] border-l-pand-azul bg-white p-5 shadow-panel transition-opacity",
                !tipo.activo && "opacity-60",
              )}
            >
              <div className="flex flex-wrap items-end gap-4">
                <label className="flex h-9 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={tipo.activo}
                    onChange={(event) =>
                      setPropio(tipo.id, { activo: event.target.checked })
                    }
                    className="h-4 w-4 rounded border-pand-border"
                  />
                  <span className="text-sm font-semibold">Activo</span>
                </label>

                <div className="min-w-[200px] space-y-1">
                  <label
                    htmlFor={`tipo-${tipo.id}`}
                    className="block text-[11px] text-pand-gris"
                  >
                    Nombre
                  </label>
                  <Input
                    id={`tipo-${tipo.id}`}
                    value={tipo.label}
                    maxLength={40}
                    onChange={(event) =>
                      setPropio(tipo.id, { label: event.target.value })
                    }
                    className="h-9 w-[220px]"
                  />
                </div>

                <div className="min-w-[200px] space-y-1">
                  <label
                    htmlFor={`tipo-base-${tipo.id}`}
                    className="block text-[11px] text-pand-gris"
                  >
                    Cuenta como
                  </label>
                  <NativeSelect
                    id={`tipo-base-${tipo.id}`}
                    value={tipo.base}
                    onChange={(event) => {
                      const base = event.target.value as ActionType;
                      // Al cambiar la base cambian los resultados admitidos: los
                      // que ya no corresponden se destildan solos. Dejarlos haría
                      // que el servidor los descarte en silencio al guardar.
                      const admitidos = opcionesPara(base).map((o) => o.codigo);
                      setPropio(tipo.id, {
                        base,
                        resultados: tipo.resultados.filter((r) =>
                          admitidos.includes(r),
                        ),
                      });
                    }}
                    className="h-9"
                  >
                    {basesManuales.map((base) => (
                      <option key={base} value={base}>
                        {estado.tipos[base]?.label ?? ACTION_TYPE_LABELS[base]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Borrar ${tipo.label}`}
                  onClick={() => borrarTipo(tipo.id)}
                  className="h-9 text-pand-coral hover:bg-pand-coral/10"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>

                <span className="mono self-center text-xs text-pand-gris">
                  {tipo.id}
                </span>
              </div>

              {opciones.length > 0 && (
                <ResultadosDelTipo
                  opciones={opciones}
                  elegidos={tipo.resultados}
                  activo={tipo.activo}
                  onToggle={(codigo) => toggleResultado(tipo.id, codigo, true)}
                />
              )}
            </div>
          );
        })}
      </section>

      {delSistema.length > 0 && (
        <section className="rounded-card border border-pand-border bg-pand-bg p-5">
          <p className="etiqueta">Las crea el sistema</p>
          <p className="mt-2 text-sm text-pand-gris">
            {delSistema.map((t) => t.label).join(" · ")}. No se cargan a mano: las
            genera el producto cuando registra un compromiso o cuando responde el
            agente de llamadas.
          </p>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={saving || sinNombre} onClick={guardar}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar tipificaciones
        </Button>
        <Button
          variant="outline"
          disabled={saving}
          onClick={() => {
            const propias =
              estado.tiposPropios.length + estado.resultadosPropios.length;
            if (
              propias > 0 &&
              !window.confirm(
                `Volver a los valores de fábrica borra las ${propias} tipificaciones que creaste. ¿Seguimos?`,
              )
            ) {
              return;
            }
            restaurar();
          }}
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Volver a los valores de fábrica
        </Button>

        {sinNombre && (
          <p className="text-xs text-pand-coral">
            Hay una tipificación sin nombre. Ponele uno o borrala.
          </p>
        )}
      </div>
    </div>
  );
}

/** Las pastillas de resultados de un tipo. Igual para los propios y los de fábrica. */
function ResultadosDelTipo({
  opciones,
  elegidos,
  activo,
  onToggle,
}: {
  opciones: { codigo: string; label: string }[];
  elegidos: string[];
  activo: boolean;
  onToggle: (codigo: string) => void;
}) {
  return (
    <div className="mt-4 border-t border-pand-border pt-3">
      <p className="etiqueta">Resultados que se ofrecen</p>

      <div className="mt-2 flex flex-wrap gap-2">
        {opciones.map((opcion) => {
          const elegido = elegidos.includes(opcion.codigo);
          return (
            <button
              key={opcion.codigo}
              type="button"
              aria-pressed={elegido}
              disabled={!activo}
              onClick={() => onToggle(opcion.codigo)}
              className={cn(
                "rounded-badge border px-3 py-1.5 text-xs font-semibold transition-colors",
                elegido
                  ? "border-pand-azul bg-pand-azul text-white"
                  : "border-pand-border text-pand-gris hover:text-pand-contorno",
              )}
            >
              {opcion.label}
            </button>
          );
        })}
      </div>

      {activo && elegidos.length === 0 && (
        <p className="mt-2 text-xs text-pand-coral">
          Sin resultados, el operador no va a poder cerrar una gestión de este tipo.
        </p>
      )}
    </div>
  );
}
