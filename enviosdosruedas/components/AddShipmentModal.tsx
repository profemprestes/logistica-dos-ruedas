'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { parseWhatsappText, type ParsedRow } from '@/lib/parseWhatsapp';
import {
  PAYMENT_LABEL,
  cashBreakdown,
  money,
  NOMBRE_EN_EL_PAQUETE,
  NOMBRE_FLEX,
  type PaymentMode,
  type Shipment,
} from '@/lib/format';
import VerificarPunto from '@/components/admin/VerificarPunto';
import ElegirComercio from '@/components/admin/ElegirComercio';
import { asegurarComercio, problemaDelComercio } from '@/lib/admin/comercios';
import { notificarRepartidor } from '@/lib/notify';

type Mode = 'manual' | 'pegar';

/**
 * Le pide al servidor que ubique los envíos recién cargados en el mapa.
 *
 * No se espera la respuesta a propósito: buscar las coordenadas tarda un
 * segundo por envío y el punto es un extra: si falla, el envío igual quedó
 * guardado y el repartidor tiene la dirección y el "Cómo llegar" de siempre.
 * Hacerlo esperar sería cobrarle al que carga un beneficio que es del que
 * reparte.
 */
async function ubicarEnElMapa(ids: number[]) {
  if (!ids.length) return;

  /*
   * El servidor ubica de a seis por llamada —Nominatim pide una consulta por
   * segundo y Vercel corta a los treinta— y avisa si quedaron más. Antes se
   * llamaba una sola vez: una tanda de veinte envíos pegada de WhatsApp
   * terminaba con seis ubicados y catorce sin punto, sin que nada lo dijera.
   *
   * El tope de vueltas es un cinturón: si el servidor contestara siempre que
   * quedan más, esto quedaría dando vueltas para siempre.
   */
  const MAX_VUELTAS = 12;

  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? '';

    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) return;

      // Los ya ubicados quedan afuera solos: el servidor sólo mira los que
      // tienen `lat` en null, así que mandar la lista entera no los repite.
      const { quedanMas, guardados } = (await res.json()) as {
        quedanMas?: boolean;
        guardados?: number;
      };

      if (!quedanMas) return;

      // Una vuelta que no ubicó nada quiere decir que lo que queda no lo
      // resuelve el buscador: son direcciones sucias, y volver a preguntarlas
      // devuelve lo mismo y gasta el cupo de Nominatim. Se cortan acá y quedan
      // marcadas como "sin ubicar" para ponerles el punto a mano.
      if (!guardados) return;
    }
  } catch {
    // Sin punto en el mapa se trabaja igual. No se molesta a nadie con esto.
  }
}

/**
 * Los campos de asignación que van con el envío al guardarlo.
 *
 * `pendiente_retiro` y no `creado`: asignado quiere decir que ya tiene dueño y
 * está esperando que lo pase a buscar. Es el mismo salto que hace el
 * desplegable de la tabla, escrito una sola vez para que no se separen.
 */
function camposDeAsignacion(driverId: string): {
  assigned_driver?: string;
  assigned_at?: string;
  status?: string;
} {
  if (!driverId) return {};
  return {
    assigned_driver: driverId,
    assigned_at: new Date().toISOString(),
    status: 'pendiente_retiro',
  };
}

/**
 * Un aviso por tanda, no uno por envío.
 *
 * Ocho notificaciones seguidas en el celular de alguien que está manejando no
 * son ocho avisos: son una molestia que se descarta sin leer.
 */
async function avisarAsignacion(driverId: string, cuantos: number, primera: string) {
  if (!driverId) return;
  try {
    await notificarRepartidor({
      driverId,
      title: cuantos === 1 ? 'Te asignaron un envío' : `Te asignaron ${cuantos} envíos`,
      body: cuantos === 1 ? primera : `${primera} y ${cuantos - 1} más`,
      url: '/driver/dashboard',
      tag: 'asignacion',
    });
  } catch {
    // Que no llegue el aviso no puede voltear la carga de la tanda.
  }
}

/** Hoy + N días, en hora local. En UTC, de noche ya estaríamos en mañana. */
const fechaEn = (dias: number) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/** Formulario en blanco. Es función para que la fecha sea la de hoy, no la del día que se abrió la pestaña. */
const emptyForm = () => ({
  client_name_raw: '',
  /** El comercio elegido de la lista, si se eligió uno. Null = carga manual. */
  client_id: null as number | null,
  // El punto del COMERCIO, no del envío. Se guarda en el comercio, no acá.
  pickup_lat: null as number | null,
  pickup_lng: null as number | null,
  pickup_address: '',
  /** Piso o depto: va aparte porque el buscador de direcciones no lo entiende. */
  pickup_extra: '',
  pickup_notes: '',
  pickup_window: '',
  recipient_name: '',
  recipient_phone: '',
  address_street: '',
  address_extra: '',
  city: 'Mar del Plata',
  delivery_window: '',
  product_detail: '',
  notes: '',
  payment_mode: 'no_cobrar' as PaymentMode,
  is_flex: false,
  shipping_fee: 0,
  merchandise_amount: 0,
  amount_to_collect: 0,
  scheduled_date: new Date().toISOString().slice(0, 10),
  /** Punto confirmado a mano en el mapa. Null = que lo busque el servidor. */
  lat: null as number | null,
  lng: null as number | null,
});

type FormState = ReturnType<typeof emptyForm>;

const field =
  'w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--edr-acento)] focus:ring-2 focus:ring-[var(--edr-yellow)]/10';
const labelCls = 'block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)] mb-0.5';

/** Campo con etiqueta arriba, para que siempre se sepa qué es cada casilla. */
function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

/** Pasa un envío ya guardado al formato del formulario. */
function formFromShipment(s: Shipment): FormState {
  return {
    client_name_raw: s.client_name_raw ?? '',
    client_id: s.client_id ?? null,
    // El punto de retiro vive en el comercio, no en el envío. Al editar arranca
    // vacío y el mapita lo busca: no hay de dónde sacarlo desde acá.
    pickup_lat: null,
    pickup_lng: null,
    pickup_address: s.pickup_address ?? '',
    // El envío guarda la dirección entera; el piso vive en el comercio. Al
    // editar uno viejo el campo arranca vacío y eso está bien: lo que ya se
    // guardó no se toca solo.
    pickup_extra: '',
    pickup_notes: s.pickup_notes ?? '',
    pickup_window: s.pickup_window ?? '',
    recipient_name: s.recipient_name,
    recipient_phone: s.recipient_phone ?? '',
    address_street: s.address_street,
    address_extra: s.address_extra ?? '',
    city: s.city,
    delivery_window: s.delivery_window ?? '',
    product_detail: s.product_detail ?? '',
    notes: s.notes ?? '',
    payment_mode: s.payment_mode,
    is_flex: Boolean(s.is_flex),
    shipping_fee: Number(s.shipping_fee),
    merchandise_amount: Number(s.merchandise_amount),
    amount_to_collect: Number(s.amount_to_collect ?? 0),
    scheduled_date: s.scheduled_date,
    lat: s.lat ?? null,
    lng: s.lng ?? null,
  };
}

/**
 * Mientras está cerrado no se monta nada: al abrirlo el formulario nace limpio,
 * sin necesidad de un efecto que vaya reseteando los campos.
 * El `key` cubre el caso de saltar de un envío a otro sin cerrar el modal.
 */
export default function AddShipmentModal({
  open,
  onClose,
  onSaved,
  editing,
  drivers = [],
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing?: Shipment | null;
  /** Para poder asignar la tanda entera al cargarla. */
  drivers?: { id: string; full_name: string }[];
}) {
  if (!open) return null;
  return (
    <ShipmentForm
      key={editing ? `edit-${editing.id}` : 'nuevo'}
      editing={editing ?? null}
      onClose={onClose}
      onSaved={onSaved}
      drivers={drivers}
    />
  );
}

function ShipmentForm({
  editing,
  onClose,
  onSaved,
  drivers,
}: {
  editing: Shipment | null;
  onClose: () => void;
  onSaved: () => void;
  drivers: { id: string; full_name: string }[];
}) {
  const [mode, setMode] = useState<Mode>('manual');
  const [form, setForm] = useState<FormState>(() =>
    editing ? formFromShipment(editing) : emptyForm(),
  );
  const [raw, setRaw] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  /** Para qué día es la tanda que se está pegando. */
  const [fechaLote, setFechaLote] = useState(() => fechaEn(0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /** Se guardó el envío pero sin comercio enlazado: se avisa sin frenar nada. */
  const [avisoComercio, setAvisoComercio] = useState('');

  /**
   * El punto de retiro confirmado a mano, por comercio, al pegar una tanda.
   *
   * VA POR COMERCIO Y NO POR ENVÍO porque el punto ES del comercio: veinte
   * etiquetas del mismo local se retiran en el mismo lugar, y pedir veinte
   * veces el mismo pin sería hacerle perder el tiempo al que carga.
   */
  const [puntosRetiro, setPuntosRetiro] = useState<
    Record<string, { lat: number; lng: number } | null>
  >({});

  /** El horario de retiro por comercio, al pegar una tanda. */
  const [horariosRetiro, setHorariosRetiro] = useState<Record<string, string>>({});

  /** Los comercios ya cargados, para mostrar el punto que YA tienen guardado. */
  const [comerciosConocidos, setComerciosConocidos] = useState<
    { id: number; name: string; lat: number | null; lng: number | null; pickup_window: string | null }[]
  >([]);
  /**
   * A quién se le asigna lo que se está cargando.
   *
   * Vale para el envío suelto y para la tanda entera: cargar ocho y después
   * asignarlos de a uno con el desplegable de la tabla son ocho vueltas para
   * una decisión que ya estaba tomada al pegarlos.
   */
  const [asignarA, setAsignarA] = useState(editing?.assigned_driver ?? '');

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const updateRow = (tempId: string, patch: Partial<ParsedRow>) =>
    setRows((rs) => rs.map((r) => (r.tempId === tempId ? { ...r, ...patch } : r)));

  /** La clave con la que se agrupa un comercio: su nombre, sin adornos. */
  const claveComercio = (nombre: string | null | undefined) =>
    (nombre ?? '').trim().toLowerCase();

  /**
   * Los comercios distintos de la tanda pegada, uno por nombre.
   *
   * Un WhatsApp suele ser todo del mismo local, así que casi siempre es uno
   * solo. Pero cuando vienen dos pegados, cada uno tiene su punto.
   */
  const retiros = useMemo(() => {
    const m = new Map<string, { nombre: string; direccion: string; cuantos: number }>();

    for (const r of rows) {
      const clave = claveComercio(r.clientName);
      if (!clave) continue;

      const previo = m.get(clave);
      m.set(clave, {
        nombre: r.clientName,
        // La primera dirección que aparece manda: si una línea vino sucia, la
        // corrección se hace en la fila y desde ahí se propaga.
        direccion: previo?.direccion || (r.pickupAddress ?? ''),
        cuantos: (previo?.cuantos ?? 0) + 1,
      });
    }

    return [...m.entries()];
  }, [rows]);

  /*
   * Los comercios ya cargados, para poder mostrar el punto que YA tienen.
   *
   * Se piden una sola vez cuando hay filas en pantalla. Son quince y entran en
   * una consulta: filtrar por nombre serían tantas consultas como comercios
   * distintos, para ahorrar unos kilobytes.
   */
  useEffect(() => {
    if (retiros.length === 0) return;
    let vivo = true;

    async function traer() {
      const { data } = await supabase.from('clients').select('id, name, lat, lng, pickup_window');
      if (vivo) setComerciosConocidos(data ?? []);
    }

    void traer();
    return () => {
      vivo = false;
    };
  }, [retiros.length]);

  /** El horario a mostrar: el que escribiste ahora, o el que ya tenía la ficha. */
  const horarioDeRetiroDe = (clave: string) => {
    const escrito = horariosRetiro[clave];
    if (escrito !== undefined) return escrito;
    const guardado = comerciosConocidos.find((c) => claveComercio(c.name) === clave);
    return guardado?.pickup_window ?? '';
  };

  /** El punto a mostrar: el que confirmaste ahora, o el que ya tenía guardado. */
  const puntoDeRetiro = (clave: string) => {
    const confirmado = puntosRetiro[clave];
    if (confirmado !== undefined) return confirmado;

    const guardado = comerciosConocidos.find((c) => claveComercio(c.name) === clave);
    return guardado && guardado.lat != null && guardado.lng != null
      ? { lat: guardado.lat, lng: guardado.lng }
      : null;
  };

  /** Cambiar la fecha del lote mueve todo lo que ya está en pantalla. */
  const cambiarFechaLote = (fecha: string) => {
    setFechaLote(fecha);
    setRows((rs) => rs.map((r) => ({ ...r, scheduledDate: fecha })));
  };

  async function saveManual() {
    /*
     * La dirección sí es obligatoria; el nombre no.
     *
     * Muchos envíos llegan sin nombre y así se trabaja: el dato está escrito en
     * el sobre. Exigirlo hacía que el que carga escribiera "Sin nombre" para
     * poder guardar, y ese relleno terminaba impreso en la etiqueta y en el
     * comprobante, donde ya no había forma de distinguirlo del nombre de
     * alguien. Vacío, cada pantalla dice lo que corresponde
     * (`nombreDelDestinatario`).
     */
    if (!form.address_street.trim()) {
      setError('La dirección de entrega es obligatoria.');
      return;
    }
    setSaving(true);
    setError('');
    /*
     * El piso se junta con la dirección al guardar, y no es un descuido.
     *
     * El envío tiene UN campo para el retiro, y lo que el repartidor necesita
     * leer en la tarjeta es "Belgrano 2875 5A" completo. Separarlos importa en
     * el comercio, donde la dirección se usa para BUSCAR EL PUNTO y el "5A" la
     * rompe. Acá ya no se busca nada: el punto sale del comercio, por client_id.
     */
    // `pickup_lat/lng` son del comercio y no columnas del envío: si se colaran
    // en el insert, PostgREST rechazaría el guardado entero.
    const { pickup_extra, pickup_lat, pickup_lng, ...delFormulario } = form;

    /*
     * Si escribió un comercio que no estaba en la lista, se crea acá con su
     * punto. Es lo que hace que la lista se llene sola trabajando, en vez de
     * tener que ir a cargarla antes.
     *
     * No se hace cuando ya eligió uno de la lista: ese ya tiene su punto
     * verificado, y volver a buscarlo podría pisarlo con uno peor.
     */
    const clientId =
      form.client_id ??
      (await asegurarComercio({
        nombre: form.client_name_raw,
        direccion: form.pickup_address,
        extra: pickup_extra,
        notas: form.pickup_notes,
        // Si lo verificaste en el mapa, ese punto y no el que salga de buscar.
        punto: pickup_lat != null && pickup_lng != null ? { lat: pickup_lat, lng: pickup_lng } : null,
      }));

    const payload = {
      ...delFormulario,
      client_id: clientId,
      pickup_address: [form.pickup_address.trim(), pickup_extra.trim()]
        .filter(Boolean)
        .join(' '),
      ...camposDeAsignacion(asignarA),
      shipping_fee: Number(form.shipping_fee) || 0,
      merchandise_amount: Number(form.merchandise_amount) || 0,
      amount_to_collect:
        form.payment_mode === 'cobrar_destinatario' ? Number(form.amount_to_collect) || 0 : 0,
    };
    /**
     * Si confirmaste el punto en el mapa, manda el tuyo y no se busca nada.
     * Vos viste dónde cae; el buscador automático, no.
     */
    const puntoManual = form.lat != null && form.lng != null;

    // Sin punto manual, sólo se vuelve a buscar cuando cambió la dirección: si
    // no, sería gastar el cupo de Nominatim para llegar al mismo lugar.
    const cambioDireccion =
      !editing ||
      editing.address_street !== payload.address_street ||
      editing.city !== payload.city;

    const aGuardar =
      !puntoManual && cambioDireccion ? { ...payload, lat: null, lng: null } : payload;

    const { data: guardado, error: dbError } = editing
      ? await supabase.from('shipments').update(aGuardar).eq('id', editing.id).select('id')
      : await supabase.from('shipments').insert(aGuardar).select('id');

    setSaving(false);
    if (dbError) return setError(dbError.message);

    /*
     * SI QUEDÓ SIN COMERCIO, DECIRLO.
     *
     * El envío se guardó igual, y eso no se discute: perderlo por no poder
     * enlazar un comercio sería cambiar un problema chico por uno grande. Pero
     * sin el enlace el repartidor NO VE EL PUNTO DE RETIRO en el mapa — le
     * queda la dirección escrita en la tarjeta y nada más.
     *
     * Hasta hoy esto no se notaba en ningún lado. El 18/08/2026 salieron cinco
     * envíos así, de comercios que ya estaban cargados y con punto.
     */
    if (!clientId) {
      const porque = problemaDelComercio();
      setAvisoComercio(
        `El envío se guardó, pero no quedó enlazado a un comercio${porque ? `: ${porque}` : ''}. ` +
          'El repartidor no va a ver el punto de retiro en el mapa.',
      );
    }

    if (!puntoManual && cambioDireccion) {
      void ubicarEnElMapa((guardado ?? []).map((s) => s.id));
    }

    // Sólo si cambió de dueño: guardar un envío ya asignado sin tocar el
    // repartidor no tiene por qué volver a sonarle el celular.
    if (asignarA && asignarA !== editing?.assigned_driver) {
      void avisarAsignacion(asignarA, 1, payload.address_street);
    }

    onSaved();
    onClose();
  }

  async function saveParsed() {
    // Los FLEX se guardan como cualquier otro envío: el repartidor los tiene que
    // ver en su hoja de ruta. Lo que cambia es cómo los cierra (ver `is_flex`).
    const toSave = rows;
    if (toSave.length === 0) return setError('No hay envíos para guardar.');
    setSaving(true);
    setError('');

    /*
     * EL COMERCIO TAMBIÉN SE ENLAZA ACÁ, y faltaba.
     *
     * El enlace estaba sólo en el formulario manual, así que todo lo que entra
     * pegando el WhatsApp nacía sin comercio. Se ve bien en el panel —el nombre
     * y la dirección de retiro están escritos— pero el repartidor NO VE EL
     * PUNTO DE RETIRO en el mapa, porque el punto vive en el comercio y el
     * envío no lo apuntaba.
     *
     * Pasó el 18/08/2026 con cinco envíos de comercios que ya estaban
     * cargados y con punto: WELIVERY, WAYFARER, AMA Y POLA. Y era la forma
     * normal de cargar, no un caso raro.
     *
     * UNO POR NOMBRE DISTINTO, no uno por envío: veinte etiquetas del mismo
     * comercio son una sola búsqueda. Con veinte se gastaría el cupo del
     * buscador de direcciones para llegar al mismo lugar.
     */
    const comercios = new Map<string, number | null>();
    for (const r of toSave) {
      const clave = claveComercio(r.clientName);
      if (!clave || comercios.has(clave)) continue;

      comercios.set(
        clave,
        await asegurarComercio({
          nombre: r.clientName,
          direccion: r.pickupAddress ?? '',
          notas: r.pickupNotes ?? '',
          // El pin que confirmaste arriba, si lo confirmaste. Si el comercio ya
          // tenía uno guardado, `asegurarComercio` no lo pisa.
          punto: puntosRetiro[clave] ?? null,
          // El horario sí se pisa cuando lo escribís: es un dato que cambia
          // —el local cambia el horario en verano— y el que carga lo está
          // mirando en ese momento.
          horario: horariosRetiro[clave],
        }),
      );
    }

    const sinEnlazar = [...comercios.entries()].filter(([, id]) => id === null).length;

    const payload = toSave.map((r) => ({
      client_id: comercios.get(claveComercio(r.clientName)) ?? null,
      client_name_raw: r.clientName,
      pickup_address: r.pickupAddress,
      pickup_notes: r.pickupNotes,
      recipient_name: r.recipientName,
      recipient_phone: r.recipientPhone,
      address_street: r.addressStreet,
      address_extra: r.addressExtra,
      city: r.city,
      delivery_window: r.deliveryWindow,
      product_detail: r.productDetail,
      notes: r.notes,
      payment_mode: r.paymentMode,
      is_flex: r.isReminder,
      shipping_fee: r.shippingFee,
      merchandise_amount: r.merchandiseAmount,
      amount_to_collect: r.paymentMode === 'cobrar_destinatario' ? r.amountToCollect : 0,
      // Va SIEMPRE explícita. Antes no se mandaba y quedaba la fecha por defecto
      // de la base, que es UTC: una tanda cargada de noche nacía con la fecha de
      // mañana y, desde el paso 14, el repartidor no la podía tocar.
      scheduled_date: r.scheduledDate,
      // El punto que se confirmó a mano, si se confirmó. El buscador automático
      // no lo pisa: `/api/geocode` sólo toca los que tienen `lat` en null.
      lat: r.lat,
      lng: r.lng,
      ...camposDeAsignacion(asignarA),
    }));
    const { data: guardados, error: dbError } = await supabase
      .from('shipments')
      .insert(payload)
      .select('id');

    setSaving(false);
    if (dbError) return setError(dbError.message);

    // Igual que en el formulario manual: si algún comercio no se pudo enlazar,
    // decirlo. Los envíos quedaron guardados; lo que falta es el punto.
    if (sinEnlazar > 0) {
      const porque = problemaDelComercio();
      setAvisoComercio(
        `Se guardaron los envíos, pero ${sinEnlazar} comercio(s) no quedaron enlazados` +
          `${porque ? `: ${porque}` : ''}. El repartidor no va a ver el punto de retiro de esos.`,
      );
    }

    void ubicarEnElMapa((guardados ?? []).map((s) => s.id));
    void avisarAsignacion(asignarA, toSave.length, toSave[0]?.addressStreet ?? '');

    onSaved();
    onClose();
  }

  const formCash = cashBreakdown(form.payment_mode, form.shipping_fee, form.merchandise_amount);

  const totalParsed = rows
    .filter((r) => !r.isReminder)  // en un FLEX no se cobra nada acá
    .reduce(
      (a, r) =>
        a +
        (r.paymentMode === 'cobrar_destinatario' ? r.amountToCollect : 0) +
        (r.paymentMode === 'cobrar_al_retirar' ? r.shippingFee : 0),
      0,
    );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-6 w-full max-w-5xl rounded-lg bg-[var(--edr-surface)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--edr-border)] px-5 py-4">
          <h2 className="text-lg font-bold">
            {editing ? `Editar envío ${editing.tracking_code}` : 'Nuevo envío'}
          </h2>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-2xl leading-none text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]"
          >
            ×
          </button>
        </div>

        {/* Arriba de las solapas porque vale para los dos modos: el envío
            suelto y la tanda entera. Cargar ocho y después asignarlos de a uno
            con el desplegable de la tabla son ocho vueltas para una decisión
            que ya estaba tomada al pegarlos. */}
        {drivers.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--edr-border)] px-5 py-3">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)]">
              Asignar a
            </label>
            <select
              value={asignarA}
              onChange={(e) => setAsignarA(e.target.value)}
              className={`${field} w-auto`}
            >
              <option value="">Nadie (lo toma por escaneo)</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name}
                </option>
              ))}
            </select>
            {asignarA && (
              <span className="text-xs text-[var(--edr-muted)]">
                {editing
                  ? 'Queda asignado a esta persona.'
                  : 'Todo lo que se cargue ahora queda asignado y le llega un aviso.'}
              </span>
            )}
          </div>
        )}

        {!editing && (
          <div className="flex gap-1 border-b border-[var(--edr-border)] px-5 pt-3">
            {(['manual', 'pegar'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-t px-4 py-2 text-sm font-semibold ${
                  mode === m
                    ? 'border-b-2 border-[var(--edr-yellow)] text-[var(--edr-acento)]'
                    : 'text-[var(--edr-muted)] hover:text-[var(--edr-muted)]'
                }`}
              >
                {m === 'manual' ? 'Carga manual' : 'Pegar mensaje de WhatsApp'}
              </button>
            ))}
          </div>
        )}

        <div className="px-5 py-5">
          {/* ============================ MANUAL ============================ */}
          {mode === 'manual' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Comercio / remitente" className="sm:col-span-2">
                <input
                  className={field}
                  value={form.client_name_raw}
                  onChange={(e) => {
                    set('client_name_raw', e.target.value);
                    // Cambiar el nombre a mano suelta el comercio elegido: si
                    // no, el envío quedaría enganchado a uno que ya no dice.
                    if (form.client_id) set('client_id', null);
                  }}
                />
                {/* Escribir "toy" trae Toy Piola con su dirección, su piso y
                    sus notas. No obliga: los retiros eventuales se siguen
                    escribiendo a mano. */}
                <ElegirComercio
                  valor={form.client_name_raw}
                  onElegir={(c) => {
                    set('client_id', c.id);
                    set('client_name_raw', c.name);
                    set('pickup_address', c.pickup_address ?? '');
                    set('pickup_extra', c.pickup_extra ?? '');
                    set('pickup_notes', c.pickup_notes ?? '');
                    // Y su punto, para verlo en el mapa sin volver a buscarlo.
                    set('pickup_lat', c.lat ?? null);
                    set('pickup_lng', c.lng ?? null);
                  }}
                  onLimpiar={() => set('client_id', null)}
                />
              </Field>
              <Field label="Dirección de retiro">
                <input className={field} value={form.pickup_address} onChange={(e) => set('pickup_address', e.target.value)} />
                {/* El mismo control que la dirección de entrega, y por la misma
                    razón: el repartidor va a ese punto. Si cae en otra cuadra
                    se pierde un viaje, y eso se ve acá en dos segundos o no se
                    ve nunca.

                    El punto es del COMERCIO, no del envío: se guarda en la
                    ficha del comercio y sirve para todos los envíos que vengan
                    de ahí. Por eso, si el comercio ya tenía uno verificado, se
                    muestra ése y no se vuelve a buscar. */}
                <div className="mt-1.5">
                  <VerificarPunto
                    direccion={form.pickup_address}
                    ciudad={form.city}
                    lat={form.pickup_lat}
                    lng={form.pickup_lng}
                    onPunto={(p) => {
                      set('pickup_lat', p?.lat ?? null);
                      set('pickup_lng', p?.lng ?? null);
                    }}
                  />
                </div>
              </Field>
              <Field label="Piso / depto / local">
                <input className={field} value={form.pickup_extra} onChange={(e) => set('pickup_extra', e.target.value)} />
              </Field>
              <Field label="Horario de retiro (sólo si es distinto)">
                <input
                  className={field}
                  value={form.pickup_window}
                  onChange={(e) => set('pickup_window', e.target.value)}
                  placeholder="dejalo vacío y usa el del comercio"
                />
                {/* Casi siempre va vacío: lo normal es que mande el horario
                    cargado en la ficha del comercio. Esto es para el "este
                    retiralo antes de las 12 porque el cliente lo pidió", que no
                    tiene por qué cambiarle el horario al local entero. */}
              </Field>
              <Field label="Notas de retiro" className="sm:col-span-2">
                <input className={field} value={form.pickup_notes} onChange={(e) => set('pickup_notes', e.target.value)} />
              </Field>

              <div className="mt-2 border-t border-[var(--edr-border)] pt-4 text-xs font-bold uppercase tracking-wide text-[var(--edr-muted)] sm:col-span-2">
                Destino
              </div>

              <Field label="Destinatario *">
                <input className={field} value={form.recipient_name} onChange={(e) => set('recipient_name', e.target.value)} />
              </Field>
              <Field label="Teléfono">
                <input className={field} value={form.recipient_phone} onChange={(e) => set('recipient_phone', e.target.value)} />
              </Field>
              <Field label="Dirección de entrega *" className="sm:col-span-2">
                <input className={field} value={form.address_street} onChange={(e) => set('address_street', e.target.value)} placeholder="Alberti 2791" />
                <div className="mt-1.5">
                  <VerificarPunto
                    direccion={form.address_street}
                    ciudad={form.city}
                    lat={form.lat}
                    lng={form.lng}
                    onPunto={(p) => {
                      set('lat', p?.lat ?? null);
                      set('lng', p?.lng ?? null);
                    }}
                  />
                </div>
              </Field>
              <Field label="Piso / depto">
                <input className={field} value={form.address_extra} onChange={(e) => set('address_extra', e.target.value)} />
              </Field>
              <Field label="Localidad">
                <input className={field} value={form.city} onChange={(e) => set('city', e.target.value)} />
              </Field>
              <Field label="Rango horario">
                <input className={field} value={form.delivery_window} onChange={(e) => set('delivery_window', e.target.value)} placeholder="antes de 18 hs" />
              </Field>
              <Field label="Fecha de reparto">
                <input type="date" className={field} value={form.scheduled_date} onChange={(e) => set('scheduled_date', e.target.value)} />
                {/* Cargar la tanda de mañana es lo más habitual después de
                    "hoy", y en el teléfono elegirla en el calendario es un
                    parto. Los dos atajos evitan abrirlo. */}
                <div className="mt-1 flex gap-1">
                  {[
                    { label: 'Hoy', dias: 0 },
                    { label: 'Mañana', dias: 1 },
                  ].map((a) => {
                    const valor = fechaEn(a.dias);
                    const activo = form.scheduled_date === valor;
                    return (
                      <button
                        key={a.label}
                        type="button"
                        onClick={() => set('scheduled_date', valor)}
                        className={`rounded px-2 py-1 text-xs font-bold ${
                          activo
                            ? 'bg-[var(--edr-yellow)] text-[var(--edr-blue)]'
                            : 'border border-[var(--edr-border)] text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]'
                        }`}
                      >
                        {a.label}
                      </button>
                    );
                  })}
                  {form.scheduled_date > fechaEn(0) && (
                    <span className="self-center px-1 text-xs font-semibold text-[var(--edr-acento)]">
                      El repartidor lo va a ver, pero no lo puede hacer hasta ese día.
                    </span>
                  )}
                </div>
              </Field>
              <Field label="Producto">
                <input className={field} value={form.product_detail} onChange={(e) => set('product_detail', e.target.value)} />
              </Field>

              <div className="mt-2 border-t border-[var(--edr-border)] pt-4 text-xs font-bold uppercase tracking-wide text-[var(--edr-muted)] sm:col-span-2">
                Plata
              </div>

              <label className="flex items-center gap-3 rounded-xl border-2 border-black bg-[var(--edr-yellow)] text-[var(--edr-blue)] px-4 py-3 text-[var(--edr-blue)] sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.is_flex}
                  onChange={(e) => set('is_flex', e.target.checked)}
                  className="h-5 w-5"
                />
                <span className="text-sm font-black">
                  ENVÍO FLEX — lo cierra el repartidor en la app de Envíos Flex (sin foto ni cobro)
                </span>
              </label>

              <Field label="Cómo se cobra">
                <select className={field} value={form.payment_mode} onChange={(e) => set('payment_mode', e.target.value as PaymentMode)}>
                  {Object.entries(PAYMENT_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Valor del envío">
                  <input type="number" className={`${field} edr-mono`} value={form.shipping_fee} onChange={(e) => set('shipping_fee', Number(e.target.value))} />
                </Field>
                <Field label="Mercadería">
                  <input
                    type="number"
                    className={`${field} edr-mono`}
                    value={form.merchandise_amount}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      // El total a cobrar sigue a la mercadería salvo que lo pises a mano.
                      setForm((f) =>
                        f.amount_to_collect === f.merchandise_amount
                          ? { ...f, merchandise_amount: v, amount_to_collect: v }
                          : { ...f, merchandise_amount: v },
                      );
                    }}
                  />
                </Field>
              </div>

              <Field label="TOTAL A COBRAR en la puerta" className="sm:col-span-2">
                <input
                  type="number"
                  className={`${field} edr-mono border-2 border-[var(--edr-yellow)] text-xl font-black`}
                  value={form.amount_to_collect}
                  onChange={(e) => set('amount_to_collect', Number(e.target.value))}
                  disabled={form.payment_mode !== 'cobrar_destinatario'}
                />
                <p className="mt-1 text-[11px] font-semibold text-[var(--edr-muted)]">
                  Arranca igual a la mercadería, porque casi siempre el envío ya está incluido.
                  Si en este cliente el envío se suma aparte, poné acá la suma de los dos.
                </p>
              </Field>

              <div className="rounded bg-[var(--edr-surface-2)] px-3 py-2 text-sm sm:col-span-2">
                <div>
                  A cobrar al retirar (al comercio):{' '}
                  <strong className="edr-mono">{money(formCash.atPickup)}</strong>
                </div>
                <div>
                  A cobrar en la puerta:{' '}
                  <strong className="edr-mono">{money(formCash.atDelivery)}</strong>
                </div>
                <div className="mt-1 border-t border-[var(--edr-border)] pt-1">
                  Efectivo que rinde el repartidor:{' '}
                  <strong className="edr-mono">{money(formCash.total)}</strong>
                </div>
              </div>

              <Field label="Notas para el repartidor" className="sm:col-span-2">
                <textarea className={field} rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
              </Field>
            </div>
          )}

          {/* ============================ PEGAR ============================= */}
          {mode === 'pegar' && (
            <div>
              {/* La fecha va ANTES del texto a propósito: es la decisión que hay
                  que tomar mirando el mensaje, no después de interpretarlo. */}
              <div className="mb-4 rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface-2)] px-4 py-3">
                <label className={labelCls}>¿Para qué día es esta tanda?</label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    className={`${field} max-w-[180px]`}
                    value={fechaLote}
                    onChange={(e) => cambiarFechaLote(e.target.value)}
                  />
                  {[
                    { label: 'Hoy', dias: 0 },
                    { label: 'Mañana', dias: 1 },
                  ].map((a) => {
                    const valor = fechaEn(a.dias);
                    const activo = fechaLote === valor;
                    return (
                      <button
                        key={a.label}
                        type="button"
                        onClick={() => cambiarFechaLote(valor)}
                        className={`rounded px-3 py-1.5 text-xs font-bold ${
                          activo
                            ? 'bg-[var(--edr-yellow)] text-[var(--edr-blue)]'
                            : 'border border-[var(--edr-border)] text-[var(--edr-muted)] hover:bg-[var(--edr-surface)]'
                        }`}
                      >
                        {a.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-[var(--edr-muted)]">
                  {fechaLote > fechaEn(0)
                    ? 'El repartidor los va a ver en "Próximos días", pero no los puede retirar ni entregar hasta esa fecha. Cada envío se puede mover por separado más abajo.'
                    : 'Se aplica a todos los envíos de esta tanda. Después podés cambiar alguno suelto.'}
                </p>
              </div>

              <Field label="Pegá acá el mensaje tal cual te llega">
                <textarea
                  className={`${field} font-mono text-xs`}
                  rows={8}
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  placeholder={`STARCELL\nRETIRA DESDE 10HS EN ALDREY\n- 10 A 13HS ALBERTI 2791. ENVIO $3000 (NO COBRAR)\n- ANTES 19HS C PELLEGRINI 4957. COBRAR $55930 (óxido nítrico x2, Gustavo 542235783553)`}
                />
              </Field>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => setRows(parseWhatsappText(raw, 'Mar del Plata', fechaLote))}
                  className="rounded bg-[var(--edr-yellow)] px-4 py-2 text-sm font-black text-[var(--edr-blue)] hover:brightness-95"
                >
                  Interpretar texto
                </button>
                {rows.length > 0 && (
                  <>
                    <span className="text-sm text-[var(--edr-muted)]">
                      {rows.length} envíos ·{' '}
                      {rows.filter((r) => r.warnings.length).length} con avisos
                    </span>
                    <span className="ml-auto rounded border-2 border-[var(--edr-yellow)] bg-[var(--edr-hiviz)] text-[var(--edr-blue)] px-3 py-1 text-sm font-bold">
                      Efectivo: <span className="edr-mono">{money(totalParsed)}</span>
                    </span>
                  </>
                )}
              </div>

              {rows.length > 0 && (
                <div className="mt-4 space-y-4">
                  <p className="text-sm text-[var(--edr-muted)]">
                    Revisá y corregí antes de guardar. Los FLEX se guardan igual: el
                    repartidor los ve en la hoja de ruta y los cierra en la app de Envíos Flex.
                  </p>

                  {/*
                    EL PUNTO DE RETIRO, UNO POR COMERCIO Y NO UNO POR ENVÍO.

                    Es a dónde va a ir el repartidor a buscar los paquetes: si
                    cae en otra cuadra se pierde un viaje entero, y eso se ve
                    acá en dos segundos o no se ve nunca.

                    Va agrupado porque el punto es del comercio: una tanda de
                    veinte etiquetas del mismo local se retira en un solo lugar,
                    y pedir veinte veces el mismo pin sería hacer perder el
                    tiempo al que carga. Si el comercio ya tenía punto guardado,
                    se muestra ése y no se toca.
                  */}
                  {retiros.map(([clave, retiro]) => (
                    <div
                      key={clave}
                      className="rounded-lg border border-[var(--edr-yellow)]/50 bg-[var(--edr-surface-2)] p-4"
                    >
                      <div className="mb-1 flex flex-wrap items-baseline gap-2">
                        <span className="text-sm font-black">
                          Retiro en {retiro.nombre || 'el comercio'}
                        </span>
                        <span className="text-xs text-[var(--edr-muted)]">
                          {retiro.direccion || 'sin dirección de retiro'} ·{' '}
                          {retiro.cuantos} envío{retiro.cuantos > 1 ? 's' : ''}
                        </span>
                      </div>

                      <VerificarPunto
                        direccion={retiro.direccion}
                        ciudad="Mar del Plata"
                        lat={puntoDeRetiro(clave)?.lat ?? null}
                        lng={puntoDeRetiro(clave)?.lng ?? null}
                        onPunto={(pu) =>
                          setPuntosRetiro((prev) => ({
                            ...prev,
                            [clave]: pu ? { lat: pu.lat, lng: pu.lng } : null,
                          }))
                        }
                      />

                      {/* El horario del local, para toda la tanda de una vez.
                          Va acá y no en cada fila porque es del COMERCIO: los
                          veinte paquetes se retiran en el mismo lugar y a la
                          misma hora. Se guarda en su ficha, así que la próxima
                          tanda ya viene con el horario puesto. */}
                      <div className="mt-2">
                        <label className={labelCls}>Horario de retiro del comercio</label>
                        <input
                          className={field}
                          value={horarioDeRetiroDe(clave)}
                          onChange={(e) =>
                            setHorariosRetiro((prev) => ({ ...prev, [clave]: e.target.value }))
                          }
                          placeholder="9 a 18 hs"
                        />
                        <p className="mt-1 text-[11px] text-[var(--edr-muted)]">
                          Se avisa cuando el comercio está por cerrar y todavía queda
                          algo sin retirar.
                        </p>
                      </div>
                    </div>
                  ))}

                  {rows.map((r, i) => {
                    const cash = {
                      atDelivery: r.paymentMode === 'cobrar_destinatario' ? r.amountToCollect : 0,
                      atPickup: r.paymentMode === 'cobrar_al_retirar' ? r.shippingFee : 0,
                    };
                    return (
                      <div
                        key={r.tempId}
                        className={`rounded-lg border p-4 ${
                          r.isReminder
                            ? 'border-dashed border-[var(--edr-border)] bg-[var(--edr-surface-2)]'
                            : r.warnings.length
                            ? 'border-orange-300 bg-orange-50/60'
                            : 'border-[var(--edr-border)] bg-[var(--edr-surface)]'
                        }`}
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-[var(--edr-muted)]">Envío {i + 1}</div>
                            <code className="block truncate text-[11px] text-[var(--edr-muted)]">{r.rawLine}</code>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {/* Mover un envío suelto a otro día sin sacarlo de la tanda. */}
                            <input
                              type="date"
                              value={r.scheduledDate}
                              onChange={(e) => updateRow(r.tempId, { scheduledDate: e.target.value })}
                              title="Día en que se reparte"
                              className={`rounded border px-2 py-1 text-xs ${
                                r.scheduledDate !== fechaLote
                                  ? 'border-[var(--edr-yellow)] bg-[var(--edr-surface-2)] text-[var(--edr-acento)]'
                                  : 'border-[var(--edr-border)] bg-[var(--edr-surface)] text-[var(--edr-muted)]'
                              }`}
                            />
                            {cash.atDelivery > 0 && (
                              <span className="edr-mono bg-[var(--edr-hiviz)] text-[var(--edr-blue)] px-2 py-1 text-sm font-bold">
                                {money(cash.atDelivery)}
                              </span>
                            )}
                            {cash.atPickup > 0 && (
                              <span className="edr-mono bg-sky-100 px-2 py-1 text-sm font-bold text-sky-900 ring-1 ring-sky-300">
                                {money(cash.atPickup)}
                                <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide">
                                  al retirar
                                </span>
                              </span>
                            )}
                            <button
                              onClick={() => setRows((rs) => rs.filter((x) => x.tempId !== r.tempId))}
                              className="text-xs font-semibold text-red-700 hover:underline"
                            >
                              Quitar
                            </button>
                          </div>
                        </div>

                        {/* Se puede marcar y desmarcar a mano: el parser detecta la
                            palabra FLEX, pero no todos los mensajes la traen. */}
                        <label
                          className={`mb-3 flex cursor-pointer items-center gap-3 rounded border-2 px-3 py-2 ${
                            r.isReminder
                              ? 'border-black bg-[var(--edr-yellow)] text-[var(--edr-blue)]'
                              : 'border-[var(--edr-border)] text-[var(--edr-muted)]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={r.isReminder}
                            onChange={(e) => updateRow(r.tempId, { isReminder: e.target.checked })}
                            className="h-5 w-5"
                          />
                          <span className="text-sm font-black">
                            {r.isReminder
                              ? 'ENVÍO FLEX — se cierra en la app de Envíos Flex'
                              : 'Marcar como envío FLEX'}
                          </span>
                        </label>
                        {(
                          <>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                              <Field label="Comercio">
                                <input className={field} value={r.clientName} onChange={(e) => updateRow(r.tempId, { clientName: e.target.value })} />
                              </Field>
                              <Field label="Retira en" className="sm:col-span-2">
                                <input className={field} value={r.pickupAddress} onChange={(e) => updateRow(r.tempId, { pickupAddress: e.target.value })} />
                              </Field>

                              <Field label="Dirección de entrega" className="sm:col-span-2">
                                {/* Cambiar la dirección borra el punto confirmado: si no,
                                    queda pegado el pin de la dirección anterior, que es
                                    peor que no tener ninguno. */}
                                <input
                                  className={field}
                                  value={r.addressStreet}
                                  onChange={(e) =>
                                    updateRow(r.tempId, {
                                      addressStreet: e.target.value,
                                      ...(r.lat != null ? { lat: null, lng: null } : {}),
                                    })
                                  }
                                />
                              </Field>
                              <Field label="Piso / depto">
                                <input className={field} value={r.addressExtra} onChange={(e) => updateRow(r.tempId, { addressExtra: e.target.value })} />
                              </Field>

                              <Field label="Destinatario">
                                {/* Vacío se puede dejar: el aviso de abajo dice
                                    qué va a salir impreso en su lugar. */}
                                <input
                                  className={field}
                                  value={r.recipientName}
                                  placeholder={r.isReminder ? NOMBRE_FLEX : NOMBRE_EN_EL_PAQUETE}
                                  onChange={(e) => updateRow(r.tempId, { recipientName: e.target.value })}
                                />
                              </Field>
                              <Field label="Teléfono">
                                <input className={field} value={r.recipientPhone} onChange={(e) => updateRow(r.tempId, { recipientPhone: e.target.value })} />
                              </Field>
                              <Field label="Horario">
                                <input className={field} value={r.deliveryWindow} onChange={(e) => updateRow(r.tempId, { deliveryWindow: e.target.value })} />
                              </Field>

                              <Field label="Cómo se cobra">
                                <select className={field} value={r.paymentMode} onChange={(e) => updateRow(r.tempId, { paymentMode: e.target.value as PaymentMode })}>
                                  {Object.entries(PAYMENT_LABEL).map(([v, l]) => (
                                    <option key={v} value={v}>{l}</option>
                                  ))}
                                </select>
                              </Field>
                              <Field label="Valor del envío">
                                <input type="number" className={`${field} edr-mono`} value={r.shippingFee} onChange={(e) => updateRow(r.tempId, { shippingFee: Number(e.target.value) })} />
                              </Field>
                              <Field label="Mercadería">
                                <input
                                  type="number"
                                  className={`${field} edr-mono`}
                                  value={r.merchandiseAmount}
                                  onChange={(e) => {
                                    const v = Number(e.target.value);
                                    updateRow(r.tempId, {
                                      merchandiseAmount: v,
                                      // el total sigue a la mercadería hasta que lo pisen a mano
                                      ...(r.amountToCollect === r.merchandiseAmount
                                        ? { amountToCollect: v }
                                        : {}),
                                    });
                                  }}
                                />
                              </Field>
                              <Field label="TOTAL A COBRAR">
                                <input
                                  type="number"
                                  className={`${field} edr-mono border-2 border-[var(--edr-yellow)] font-black`}
                                  value={r.amountToCollect}
                                  onChange={(e) =>
                                    updateRow(r.tempId, { amountToCollect: Number(e.target.value) })
                                  }
                                  disabled={r.paymentMode !== 'cobrar_destinatario'}
                                />
                              </Field>

                              <Field label="Producto" className="sm:col-span-1">
                                <input className={field} value={r.productDetail} onChange={(e) => updateRow(r.tempId, { productDetail: e.target.value })} />
                              </Field>
                              <Field label="Notas" className="sm:col-span-2">
                                <input className={field} value={r.notes} onChange={(e) => updateRow(r.tempId, { notes: e.target.value })} />
                              </Field>
                            </div>

                            {/* El punto, envío por envío. Una tanda pegada de
                                WhatsApp trae justo las direcciones más sucias
                                —esquinas, referencias, "planta YPF"— que son las
                                que el buscador no resuelve. Revisarlas acá evita
                                mandar al repartidor a la otra punta. */}
                            <div className="mt-3">
                              <VerificarPunto
                                direccion={r.addressStreet}
                                ciudad={r.city}
                                lat={r.lat}
                                lng={r.lng}
                                onPunto={(p) =>
                                  updateRow(r.tempId, {
                                    lat: p?.lat ?? null,
                                    lng: p?.lng ?? null,
                                  })
                                }
                              />
                            </div>

                            {/* Naranja claro: el oscuro sobre la tarjeta azul no
                                se leía, y estos son justamente los avisos de lo
                                que quedó mal interpretado. */}
                            {r.warnings.length > 0 && (
                              <ul className="mt-3 list-inside list-disc text-xs text-[var(--edr-naranja-claro)]">
                                {r.warnings.map((w, k) => (
                                  <li key={k}>{w}</li>
                                ))}
                              </ul>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mt-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}

          {/* No es un error: el envío se guardó. Es un aviso de que le falta
              algo que se nota recién en la calle, cuando el repartidor abre el
              mapa y el punto de retiro no está. */}
          {avisoComercio && (
            <div className="mt-4 rounded border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-900">
              {avisoComercio}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--edr-border)] px-5 py-4">
          <button onClick={onClose} className="rounded border border-[var(--edr-border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--edr-surface-2)]">
            Cancelar
          </button>
          <button
            onClick={mode === 'manual' ? saveManual : saveParsed}
            disabled={saving}
            className="rounded bg-[var(--edr-yellow)] px-5 py-2 text-sm font-black text-[var(--edr-blue)] hover:brightness-95 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar envío'}
          </button>
        </div>
      </div>
    </div>
  );
}
