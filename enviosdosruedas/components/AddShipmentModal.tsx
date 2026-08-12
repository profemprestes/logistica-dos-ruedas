'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { parseWhatsappText, type ParsedRow } from '@/lib/parseWhatsapp';
import { PAYMENT_LABEL, cashBreakdown, money, type PaymentMode, type Shipment } from '@/lib/format';
import VerificarPunto from '@/components/admin/VerificarPunto';

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
  try {
    const { data } = await supabase.auth.getSession();
    await fetch('/api/geocode', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${data.session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ ids }),
    });
  } catch {
    // Sin punto en el mapa se trabaja igual. No se molesta a nadie con esto.
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
  pickup_address: '',
  pickup_notes: '',
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
  'w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--edr-yellow)] focus:ring-2 focus:ring-[var(--edr-yellow)]/10';
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
    pickup_address: s.pickup_address ?? '',
    pickup_notes: s.pickup_notes ?? '',
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
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing?: Shipment | null;
}) {
  if (!open) return null;
  return (
    <ShipmentForm
      key={editing ? `edit-${editing.id}` : 'nuevo'}
      editing={editing ?? null}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function ShipmentForm({
  editing,
  onClose,
  onSaved,
}: {
  editing: Shipment | null;
  onClose: () => void;
  onSaved: () => void;
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

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const updateRow = (tempId: string, patch: Partial<ParsedRow>) =>
    setRows((rs) => rs.map((r) => (r.tempId === tempId ? { ...r, ...patch } : r)));

  /** Cambiar la fecha del lote mueve todo lo que ya está en pantalla. */
  const cambiarFechaLote = (fecha: string) => {
    setFechaLote(fecha);
    setRows((rs) => rs.map((r) => ({ ...r, scheduledDate: fecha })));
  };

  async function saveManual() {
    if (!form.recipient_name.trim() || !form.address_street.trim()) {
      setError('El destinatario y la dirección son obligatorios.');
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      ...form,
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

    if (!puntoManual && cambioDireccion) {
      void ubicarEnElMapa((guardado ?? []).map((s) => s.id));
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
    const payload = toSave.map((r) => ({
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
    }));
    const { data: guardados, error: dbError } = await supabase
      .from('shipments')
      .insert(payload)
      .select('id');

    setSaving(false);
    if (dbError) return setError(dbError.message);

    void ubicarEnElMapa((guardados ?? []).map((s) => s.id));

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

        {!editing && (
          <div className="flex gap-1 border-b border-[var(--edr-border)] px-5 pt-3">
            {(['manual', 'pegar'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-t px-4 py-2 text-sm font-semibold ${
                  mode === m
                    ? 'border-b-2 border-[var(--edr-yellow)] text-[var(--edr-yellow)]'
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
                <input className={field} value={form.client_name_raw} onChange={(e) => set('client_name_raw', e.target.value)} />
              </Field>
              <Field label="Dirección de retiro">
                <input className={field} value={form.pickup_address} onChange={(e) => set('pickup_address', e.target.value)} />
              </Field>
              <Field label="Notas de retiro">
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
                            ? 'bg-[var(--edr-yellow)] text-black'
                            : 'border border-[var(--edr-border)] text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]'
                        }`}
                      >
                        {a.label}
                      </button>
                    );
                  })}
                  {form.scheduled_date > fechaEn(0) && (
                    <span className="self-center px-1 text-xs font-semibold text-[var(--edr-yellow)]">
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

              <label className="flex items-center gap-3 rounded-xl border-2 border-black bg-[var(--edr-yellow)] text-black px-4 py-3 text-black sm:col-span-2">
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
                            ? 'bg-[var(--edr-yellow)] text-black'
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
                  className="rounded bg-[var(--edr-yellow)] px-4 py-2 text-sm font-black text-black hover:brightness-95"
                >
                  Interpretar texto
                </button>
                {rows.length > 0 && (
                  <>
                    <span className="text-sm text-[var(--edr-muted)]">
                      {rows.length} envíos ·{' '}
                      {rows.filter((r) => r.warnings.length).length} con avisos
                    </span>
                    <span className="ml-auto rounded border-2 border-[var(--edr-yellow)] bg-[var(--edr-hiviz)] text-black px-3 py-1 text-sm font-bold">
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
                                  ? 'border-[var(--edr-yellow)] bg-[var(--edr-surface-2)] text-[var(--edr-yellow)]'
                                  : 'border-[var(--edr-border)] bg-[var(--edr-surface)] text-[var(--edr-muted)]'
                              }`}
                            />
                            {cash.atDelivery > 0 && (
                              <span className="edr-mono bg-[var(--edr-hiviz)] text-black px-2 py-1 text-sm font-bold">
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
                              ? 'border-black bg-[var(--edr-yellow)] text-black'
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
                                <input className={field} value={r.addressStreet} onChange={(e) => updateRow(r.tempId, { addressStreet: e.target.value })} />
                              </Field>
                              <Field label="Piso / depto">
                                <input className={field} value={r.addressExtra} onChange={(e) => updateRow(r.tempId, { addressExtra: e.target.value })} />
                              </Field>

                              <Field label="Destinatario">
                                <input className={field} value={r.recipientName} onChange={(e) => updateRow(r.tempId, { recipientName: e.target.value })} />
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

                            {r.warnings.length > 0 && (
                              <ul className="mt-3 list-inside list-disc text-xs text-orange-900">
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
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--edr-border)] px-5 py-4">
          <button onClick={onClose} className="rounded border border-[var(--edr-border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--edr-surface-2)]">
            Cancelar
          </button>
          <button
            onClick={mode === 'manual' ? saveManual : saveParsed}
            disabled={saving}
            className="rounded bg-[var(--edr-yellow)] px-5 py-2 text-sm font-black text-black hover:brightness-95 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar envío'}
          </button>
        </div>
      </div>
    </div>
  );
}
