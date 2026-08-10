'use client';

import QRCode from 'react-qr-code';
import type { Shipment } from '@/lib/format';
import { money, shipmentCash } from '@/lib/format';

/**
 * Etiqueta de 100mm x 150mm para impresora térmica.
 * Todas las medidas van en mm para que lo que ves en pantalla
 * sea exactamente lo que sale por la impresora.
 *
 * El QR contiene ÚNICAMENTE el ID interno del envío (ej: "1000"),
 * que es lo que la app del repartidor le pasa a scan_and_assign().
 */
export default function ShippingLabel({ shipment }: { shipment: Shipment }) {
  const cash = shipmentCash(shipment);
  const hasToCollect = cash.total > 0;

  return (
    <div
      className="edr-label bg-white text-black"
      style={{
        width: '100mm',
        height: '150mm',
        padding: '4mm',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Arial, Helvetica, sans-serif',
      }}
    >
      {/* ---------- ENCABEZADO ---------- */}
      <div
        style={{
          borderBottom: '1mm solid #000',
          paddingBottom: '2mm',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '7.5mm', fontWeight: 900, lineHeight: 1, letterSpacing: '-0.3mm' }}>
          Envíos DosRuedas
        </div>
        <div style={{ fontSize: '3mm', letterSpacing: '0.5mm', marginTop: '1mm' }}>
          www.enviosdosruedas.com
        </div>
      </div>

      {/* ---------- QR ---------- */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '3mm 0 2mm',
        }}
      >
        <QRCode
          value={String(shipment.id)}
          size={200}
          level="M"
          style={{ width: '48mm', height: '48mm' }}
        />
        <div
          className="edr-mono"
          style={{ fontSize: '5mm', fontWeight: 700, marginTop: '2mm', letterSpacing: '0.2mm' }}
        >
          {shipment.tracking_code}
        </div>
      </div>

      {/* ---------- DATOS DE ENTREGA ---------- */}
      <div style={{ borderTop: '0.4mm solid #000', paddingTop: '2mm', flex: 1, minHeight: 0 }}>
        <div style={{ fontSize: '2.6mm', letterSpacing: '0.4mm', textTransform: 'uppercase' }}>
          Entregar a
        </div>
        <div style={{ fontSize: '5mm', fontWeight: 800, lineHeight: 1.1 }}>
          {shipment.recipient_name}
        </div>

        <div style={{ fontSize: '5.5mm', fontWeight: 700, lineHeight: 1.15, marginTop: '1.5mm' }}>
          {shipment.address_street}
          {shipment.address_extra ? ` — ${shipment.address_extra}` : ''}
        </div>

        <div
          style={{
            display: 'inline-block',
            background: '#000',
            color: '#fff',
            fontSize: '4.5mm',
            fontWeight: 800,
            padding: '1mm 2.5mm',
            marginTop: '1.5mm',
            textTransform: 'uppercase',
          }}
        >
          {shipment.city}
        </div>

        {shipment.recipient_phone && (
          <div className="edr-mono" style={{ fontSize: '3.6mm', marginTop: '1.5mm' }}>
            Tel: {shipment.recipient_phone}
          </div>
        )}

        {shipment.delivery_window && (
          <div style={{ fontSize: '3.6mm', marginTop: '0.5mm' }}>
            Horario: <strong>{shipment.delivery_window}</strong>
          </div>
        )}

        {shipment.notes && (
          <div
            style={{
              fontSize: '3.2mm',
              marginTop: '1.5mm',
              lineHeight: 1.2,
              maxHeight: '12mm',
              overflow: 'hidden',
            }}
          >
            <strong>Notas:</strong> {shipment.notes}
          </div>
        )}
      </div>

      {/* ---------- PIE: PLATA ---------- */}
      <div
        style={{
          border: '1.2mm solid #000',
          background: hasToCollect ? '#000' : '#fff',
          color: hasToCollect ? '#fff' : '#000',
          textAlign: 'center',
          padding: '2mm 1mm',
          marginTop: '2mm',
        }}
      >
        {cash.atDelivery > 0 ? (
          <>
            <div style={{ fontSize: '3.2mm', letterSpacing: '1mm', fontWeight: 700 }}>
              A COBRAR EN LA PUERTA
            </div>
            <div className="edr-mono" style={{ fontSize: '9mm', fontWeight: 900, lineHeight: 1.05 }}>
              {money(cash.atDelivery)}
            </div>
            {shipment.shipping_fee > 0 && shipment.merchandise_amount > 0 && (
              <div className="edr-mono" style={{ fontSize: '3mm' }}>
                (envío {money(shipment.shipping_fee)} + mercadería{' '}
                {money(shipment.merchandise_amount)})
              </div>
            )}
          </>
        ) : cash.atPickup > 0 ? (
          <>
            <div style={{ fontSize: '3.2mm', letterSpacing: '1mm', fontWeight: 700 }}>
              COBRAR AL RETIRAR — AL COMERCIO
            </div>
            <div className="edr-mono" style={{ fontSize: '9mm', fontWeight: 900, lineHeight: 1.05 }}>
              {money(cash.atPickup)}
            </div>
            <div style={{ fontSize: '3mm', fontWeight: 700 }}>
              NO SE LE COBRA NADA AL DESTINATARIO
            </div>
          </>
        ) : (
          <div style={{ fontSize: '8mm', fontWeight: 900, letterSpacing: '1mm' }}>PAGADO</div>
        )}
      </div>

      {/* ---------- ORIGEN ---------- */}
      <div style={{ fontSize: '2.8mm', marginTop: '1.5mm', display: 'flex', justifyContent: 'space-between' }}>
        <span>De: {shipment.client_name_raw ?? '—'}</span>
        <span className="edr-mono">{shipment.scheduled_date}</span>
      </div>
    </div>
  );
}
