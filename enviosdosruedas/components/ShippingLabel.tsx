'use client';

import QRCode from 'react-qr-code';
import LabelLogo from '@/components/LabelLogo';
import type { Shipment } from '@/lib/format';
import { money } from '@/lib/format';

/**
 * Etiqueta de 100mm x 150mm para impresora térmica.
 *
 * Todas las medidas van en mm para que lo que se ve en pantalla sea exactamente
 * lo que sale por la impresora.
 *
 * REGLAS DE LA TÉRMICA (por eso no hay ni un color acá):
 *  - Es monocromo: quema el papel. Un gris sale reticulado y sucio.
 *  - Los trazos finos se pierden; todo va macizo o con borde grueso.
 *  - El contraste manda sobre la marca: por eso la etiqueta es blanco y negro
 *    aunque el resto del sistema sea azul y amarillo.
 *
 * El QR contiene ÚNICAMENTE el id interno del envío (ej: "1000"), que es lo que
 * la app del repartidor le pasa a scan_and_assign().
 */
export default function ShippingLabel({ shipment }: { shipment: Shipment }) {
  /**
   * El monto sale SÓLO si se cobra en la puerta. Si se cobra al retirar, esa
   * plata ya la puso el comercio y que figure acá haría que el repartidor se la
   * pida al destinatario por segunda vez.
   */
  const cobraEnPuerta = shipment.payment_mode === 'cobrar_destinatario';
  const aCobrar = Number(shipment.amount_to_collect ?? 0);
  const mostrarMonto = cobraEnPuerta && aCobrar > 0;

  const adicionales = [shipment.product_detail, shipment.notes].filter(Boolean).join(' · ');

  return (
    <div
      className="edr-label"
      style={{
        width: '100mm',
        height: '150mm',
        padding: '3mm',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
        color: '#000',
        fontFamily: 'Arial, Helvetica, sans-serif',
      }}
    >
      {/* ================= ENCABEZADO ================= */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1mm solid #000',
          paddingBottom: '1.5mm',
        }}
      >
        <LabelLogo height={13} />
        <div style={{ textAlign: 'right', fontSize: '2.6mm', lineHeight: 1.3 }}>
          <div style={{ fontWeight: 700 }}>2236602699</div>
          <div>enviosdosruedas.com</div>
        </div>
      </div>

      {/* ================= REMITENTE ================= */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '2mm',
          borderBottom: '0.4mm solid #000',
          padding: '1.5mm 0',
        }}
      >
        <span style={{ fontSize: '2.6mm', letterSpacing: '0.4mm' }}>DE</span>
        <span
          style={{
            fontSize: '4.2mm',
            fontWeight: 800,
            textTransform: 'uppercase',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {shipment.client_name_raw || 'Envíos DosRuedas'}
        </span>
      </div>

      {/* ================= QR + CÓDIGO ================= */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '2.5mm 0 1.5mm',
          borderBottom: '1mm solid #000',
        }}
      >
        <QRCode value={String(shipment.id)} size={256} level="M" style={{ width: '44mm', height: '44mm' }} />
        <div
          className="edr-mono"
          style={{
            fontSize: '5.6mm',
            fontWeight: 700,
            marginTop: '1.5mm',
            letterSpacing: '0.3mm',
          }}
        >
          {shipment.tracking_code}
        </div>
      </div>

      {/* ================= DESTINATARIO ================= */}
      <div style={{ flex: 1, minHeight: 0, paddingTop: '2mm', overflow: 'hidden' }}>
        <div style={{ fontSize: '2.6mm', letterSpacing: '0.5mm' }}>ENTREGAR A</div>

        <div style={{ fontSize: '4.6mm', fontWeight: 800, lineHeight: 1.15 }}>
          {shipment.recipient_name}
        </div>

        <div style={{ fontSize: '6mm', fontWeight: 900, lineHeight: 1.1, marginTop: '1mm' }}>
          {shipment.address_street}
        </div>
        {shipment.address_extra && (
          <div style={{ fontSize: '4.4mm', fontWeight: 700, lineHeight: 1.15 }}>
            {shipment.address_extra}
          </div>
        )}

        <div
          style={{
            display: 'inline-block',
            background: '#000',
            color: '#fff',
            fontSize: '4.4mm',
            fontWeight: 800,
            padding: '0.8mm 2.5mm',
            marginTop: '1.2mm',
            textTransform: 'uppercase',
          }}
        >
          {shipment.city}
        </div>

        <div style={{ display: 'flex', gap: '4mm', marginTop: '1.5mm', fontSize: '3.4mm' }}>
          {shipment.recipient_phone && (
            <span className="edr-mono">Tel {shipment.recipient_phone}</span>
          )}
          {shipment.delivery_window && (
            <span>
              Horario <strong>{shipment.delivery_window}</strong>
            </span>
          )}
        </div>

        {/* ---------- DATOS ADICIONALES (sólo si hay) ---------- */}
        {adicionales && (
          <div
            style={{
              border: '0.4mm solid #000',
              marginTop: '1.8mm',
              padding: '1.2mm 1.5mm',
              maxHeight: '14mm',
              overflow: 'hidden',
            }}
          >
            <div style={{ fontSize: '2.4mm', letterSpacing: '0.4mm' }}>DATOS ADICIONALES</div>
            <div style={{ fontSize: '3.2mm', lineHeight: 1.2, fontWeight: 600 }}>{adicionales}</div>
          </div>
        )}
      </div>

      {/* ================= A COBRAR ================= */}
      {/* Sólo cuando el cobro es contra entrega. Ver comentario de arriba. */}
      {mostrarMonto && (
        <div
          style={{
            border: '1.2mm solid #000',
            background: '#000',
            color: '#fff',
            textAlign: 'center',
            padding: '1.8mm 1mm',
            marginTop: '1.5mm',
          }}
        >
          <div style={{ fontSize: '3.2mm', letterSpacing: '1.2mm', fontWeight: 700 }}>
            COBRAR AL ENTREGAR
          </div>
          <div className="edr-mono" style={{ fontSize: '11mm', fontWeight: 900, lineHeight: 1 }}>
            {money(aCobrar)}
          </div>
        </div>
      )}

      {/* ================= PIE ================= */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '2.6mm',
          marginTop: '1.2mm',
        }}
      >
        <span>{shipment.is_flex ? 'ENVÍO FLEX' : 'Seguimiento en logisticadosruedas.com'}</span>
        <span className="edr-mono">{shipment.scheduled_date}</span>
      </div>
    </div>
  );
}
