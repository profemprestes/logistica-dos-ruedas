import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer';
import { EVENT_LABEL, REASON_LABEL, fechaHora, type ProofLog } from '@/lib/proof';
import { money, type Shipment } from '@/lib/format';

/**
 * Comprobante de entrega en PDF, hoja A4.
 *
 * Es el papel que el comercio le muestra a SU cliente cuando reclama, así que
 * está pensado como documento y no como pantalla: fondo blanco (se imprime sin
 * gastar un cartucho), datos arriba, la prueba en el medio y el pie con los
 * datos de la empresa.
 *
 * OJO con dos cosas propias de react-pdf:
 *  - No entiende webp. El logo va desde `/icon.png`.
 *  - Las imágenes tienen que venir embebidas como data URL: si guardáramos el
 *    link firmado del bucket, el archivo se quedaría sin foto en una hora.
 */

const AZUL = '#0636a5';
const AZUL_OSCURO = '#00277c';
const AMARILLO = '#ffec01';
const GRIS = '#6b7280';
const LINEA = '#d4dcec';

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 70,
    paddingHorizontal: 34,
    fontSize: 9,
    color: '#111827',
    fontFamily: 'Helvetica',
  },

  /* ---------- encabezado ---------- */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 3,
    borderBottomColor: AMARILLO,
    paddingBottom: 10,
    marginBottom: 14,
  },
  logo: { width: 46, height: 46, marginRight: 10 },
  marca: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: AZUL },
  subtitulo: { fontSize: 8, color: GRIS, letterSpacing: 1.6, marginTop: 2 },
  codigoCaja: { marginLeft: 'auto', alignItems: 'flex-end' },
  codigoLabel: { fontSize: 6.5, color: GRIS, letterSpacing: 1 },
  codigo: { fontSize: 13, fontFamily: 'Courier-Bold', color: AZUL_OSCURO },

  /* ---------- sello ---------- */
  sello: {
    borderWidth: 2,
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 14,
    alignItems: 'center',
  },
  selloTexto: { fontSize: 20, fontFamily: 'Helvetica-Bold', letterSpacing: 1.5 },
  selloFecha: { fontSize: 9, color: GRIS, marginTop: 3 },

  /* ---------- bloques ---------- */
  seccion: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: AZUL,
    letterSpacing: 1.2,
    marginBottom: 6,
    marginTop: 4,
  },
  grilla: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  celda: {
    width: '50%',
    borderWidth: 0.7,
    borderColor: LINEA,
    borderRadius: 4,
    paddingVertical: 5,
    paddingHorizontal: 7,
    marginBottom: 4,
  },
  celdaAncha: { width: '100%' },
  etiqueta: { fontSize: 6.5, color: GRIS, letterSpacing: 0.8, marginBottom: 1.5 },
  valor: { fontSize: 9.5, fontFamily: 'Helvetica-Bold' },

  /* ---------- prueba ---------- */
  prueba: {
    borderWidth: 0.7,
    borderColor: LINEA,
    borderRadius: 4,
    padding: 10,
    marginBottom: 10,
  },
  pruebaCabecera: { flexDirection: 'row', alignItems: 'center', marginBottom: 7 },
  pruebaTitulo: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  pastilla: {
    marginLeft: 'auto',
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    backgroundColor: AZUL,
    borderRadius: 3,
    paddingVertical: 2,
    paddingHorizontal: 5,
  },
  pruebaCuerpo: { flexDirection: 'row' },
  foto: {
    width: 150,
    height: 150,
    objectFit: 'cover',
    borderRadius: 4,
    borderWidth: 0.7,
    borderColor: LINEA,
    marginRight: 10,
  },
  sinFoto: {
    width: 150,
    height: 150,
    borderRadius: 4,
    borderWidth: 0.7,
    borderColor: LINEA,
    borderStyle: 'dashed',
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  datos: { flex: 1 },
  linea: { flexDirection: 'row', marginBottom: 3 },
  lineaLabel: { fontFamily: 'Helvetica-Bold', width: 70 },
  lineaValor: { flex: 1 },

  /* ---------- pie ---------- */
  pie: {
    position: 'absolute',
    bottom: 24,
    left: 34,
    right: 34,
    borderTopWidth: 2,
    borderTopColor: AMARILLO,
    paddingTop: 8,
    alignItems: 'center',
  },
  pieWeb: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: AZUL },
  pieTexto: { fontSize: 7, color: GRIS, marginTop: 2, textAlign: 'center' },
});

export interface ProofPdfProps {
  shipment: Shipment;
  logs: ProofLog[];
  /** Foto de cada movimiento, ya embebida como data URL (id del log -> imagen). */
  fotos: Record<string, string>;
  /** Cuándo se generó el papel, para que se sepa qué tan fresco es. */
  generadoEl: Date;
  /**
   * De dónde sale el logo. En el navegador alcanza la ruta pública; se puede
   * pasar una ruta de archivo para renderizar el PDF fuera del navegador.
   */
  logoSrc?: string;
}

const soloFecha = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

export default function ProofPdfDocument({
  shipment,
  logs,
  fotos,
  generadoEl,
  logoSrc = '/icon.png',
}: ProofPdfProps) {
  // El movimiento que define el estado del papel: la entrega o el intento fallido.
  const cierre = logs.find((l) => l.event === 'entregado' || l.event === 'no_entregado') ?? null;
  const entregado = cierre?.event === 'entregado';

  const colorSello = entregado ? '#047857' : cierre ? '#c2410c' : AZUL;
  const fondoSello = entregado ? '#ecfdf5' : cierre ? '#fff7ed' : '#eef4ff';

  const direccion = [
    shipment.address_street,
    shipment.address_extra,
    shipment.city,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Document
      title={`Comprobante ${shipment.tracking_code}`}
      author="Envíos DosRuedas"
      subject={`Comprobante de entrega ${shipment.tracking_code}`}
    >
      <Page size="A4" style={styles.page}>
        {/* ---------- Encabezado ---------- */}
        <View style={styles.header} fixed>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf no acepta alt */}
          <Image style={styles.logo} src={logoSrc} />
          <View>
            <Text style={styles.marca}>Envíos DosRuedas</Text>
            <Text style={styles.subtitulo}>COMPROBANTE DE ENTREGA</Text>
          </View>
          <View style={styles.codigoCaja}>
            <Text style={styles.codigoLabel}>SEGUIMIENTO</Text>
            <Text style={styles.codigo}>{shipment.tracking_code}</Text>
          </View>
        </View>

        {/* ---------- Sello ---------- */}
        <View style={[styles.sello, { borderColor: colorSello, backgroundColor: fondoSello }]}>
          <Text style={[styles.selloTexto, { color: colorSello }]}>
            {entregado ? 'ENTREGADO' : cierre ? 'NO ENTREGADO' : 'EN CURSO'}
          </Text>
          <Text style={styles.selloFecha}>
            {cierre
              ? fechaHora(cierre.happened_at)
              : 'Este envío todavía no se cerró: el comprobante se completa al entregarlo.'}
          </Text>
        </View>

        {/* ---------- Datos del envío ---------- */}
        <Text style={styles.seccion}>DATOS DEL ENVÍO</Text>
        <View style={styles.grilla}>
          <Celda label="DESTINATARIO" value={shipment.recipient_name} />
          <Celda label="TELÉFONO" value={shipment.recipient_phone || '—'} />
          <Celda label="DIRECCIÓN" value={direccion} ancha />
          <Celda label="COMERCIO / REMITENTE" value={shipment.client_name_raw || '—'} />
          <Celda label="FECHA DE REPARTO" value={soloFecha(shipment.scheduled_date)} />
          <Celda label="FRANJA HORARIA" value={shipment.delivery_window || 'Sin franja acordada'} />
          <Celda label="PRODUCTO" value={shipment.product_detail || '—'} />
          {shipment.is_flex && (
            <Celda
              label="MODALIDAD"
              value="Mercado Libre Flex — el detalle también figura en la app de Flex"
              ancha
            />
          )}
        </View>

        {/* ---------- Movimientos ---------- */}
        <Text style={styles.seccion}>PRUEBA DE ENTREGA</Text>

        {logs.length === 0 && (
          <Text style={{ color: GRIS, marginBottom: 10 }}>
            Todavía no hay movimientos registrados para este envío.
          </Text>
        )}

        {logs.map((log) => {
          const fallido = log.event === 'no_entregado';
          return (
            <View key={log.id} style={styles.prueba} wrap={false}>
              <View style={styles.pruebaCabecera}>
                <Text style={[styles.pruebaTitulo, fallido ? { color: '#c2410c' } : {}]}>
                  {EVENT_LABEL[log.event] ?? log.event}
                </Text>
                <Text style={{ fontSize: 8, color: GRIS, marginLeft: 8 }}>
                  {fechaHora(log.happened_at)}
                </Text>
                {log.driver?.full_name && <Text style={styles.pastilla}>{log.driver.full_name}</Text>}
              </View>

              <View style={styles.pruebaCuerpo}>
                {fotos[log.id] ? (
                  // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf no acepta alt
                  <Image style={styles.foto} src={fotos[log.id]} />
                ) : (
                  <View style={styles.sinFoto}>
                    <Text style={{ fontSize: 8, color: GRIS }}>Sin foto</Text>
                  </View>
                )}

                <View style={styles.datos}>
                  {log.event === 'entregado' && (
                    <>
                      <Linea label="Recibió" value={log.receiver_name || '—'} />
                      <Linea label="DNI" value={log.receiver_dni || '—'} />
                    </>
                  )}

                  {fallido && (
                    <Linea
                      label="Motivo"
                      value={REASON_LABEL[log.failure_reason ?? ''] ?? log.failure_reason ?? '—'}
                    />
                  )}

                  {log.comment && <Linea label="Comentario" value={log.comment} />}

                  {log.amount_collected !== null && (
                    <Linea label="Cobró" value={money(log.amount_collected)} />
                  )}

                  <Linea
                    label="Ubicación"
                    value={
                      log.lat != null && log.lng != null
                        ? `${log.lat.toFixed(6)}, ${log.lng.toFixed(6)}` +
                          (log.gps_accuracy != null
                            ? `  (precisión ±${Math.round(log.gps_accuracy)} m)`
                            : '')
                        : 'No registrada'
                    }
                  />

                  {log.synced_offline && (
                    <Text style={{ fontSize: 7, color: GRIS, marginTop: 3 }}>
                      Registrado sin señal y subido el {fechaHora(log.created_at)}.
                    </Text>
                  )}
                </View>
              </View>
            </View>
          );
        })}

        {/* ---------- Pie ---------- */}
        <View style={styles.pie} fixed>
          <Text style={styles.pieWeb}>www.enviosdosruedas.com</Text>
          <Text style={styles.pieTexto}>
            WhatsApp 2236602699 · Mensajería y logística de última milla · Mar del Plata, Argentina
          </Text>
          <Text style={styles.pieTexto}>
            Documento generado automáticamente el {fechaHora(generadoEl.toISOString())} ·
            Verificable en www.logisticadosruedas.com/seguimiento con el código{' '}
            {shipment.tracking_code}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

function Celda({ label, value, ancha = false }: { label: string; value: string; ancha?: boolean }) {
  return (
    <View style={ancha ? [styles.celda, styles.celdaAncha] : styles.celda}>
      <Text style={styles.etiqueta}>{label}</Text>
      <Text style={styles.valor}>{value}</Text>
    </View>
  );
}

function Linea({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.linea}>
      <Text style={styles.lineaLabel}>{label}:</Text>
      <Text style={styles.lineaValor}>{value}</Text>
    </View>
  );
}
