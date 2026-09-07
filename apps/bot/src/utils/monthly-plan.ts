/**
 * El plan se arma una vez al mes. Este mensaje es el que ve el usuario que
 * intenta rehacerlo antes de tiempo — mandando otra foto, o escribiendo
 * "reiniciar" — así que vive acá y no repetido en cada flow.
 */
export function buildAlreadyDoneMessage(generatedAt?: Date): string {
  const cuando = generatedAt
    ? ` (lo hicimos el ${generatedAt.toLocaleDateString("es-CO", {
        day: "numeric",
        month: "long",
      })})`
    : "";

  return (
    `✅ Ya tienes tu plan de ahorro de este mes${cuando}.\n\n` +
    `Armamos uno nuevo cada mes, cuando te llega la siguiente factura: escríbeme en ${nextMonthName()} y lo actualizamos con tu nuevo consumo.\n\n` +
    "Mientras tanto, pregúntame lo que quieras sobre tu plan. 💡"
  );
}

/**
 * El usuario agotó los intentos de foto sin que pudiéramos leerle el consumo.
 * A partir de acá no se procesa nada más hasta el mes siguiente, así que el
 * mensaje tiene que cerrar sin dejarlo esperando una respuesta.
 */
export function buildClosedMessage(): string {
  return (
    "⚠️ No logré procesar tu información después de varios intentos, así que " +
    "por ahora no puedo armar tu plan.\n\n" +
    `Volvamos a intentarlo en ${nextMonthName()}, cuando te llegue tu próxima factura. 📅`
  );
}

function nextMonthName(): string {
  const siguiente = new Date();
  // Día 1 antes de sumar el mes: en un 31 de enero, sumarle un mes a la fecha
  // tal cual da 3 de marzo y el nombre del mes saldría mal.
  siguiente.setDate(1);
  siguiente.setMonth(siguiente.getMonth() + 1);
  return siguiente.toLocaleDateString("es-CO", { month: "long" });
}
