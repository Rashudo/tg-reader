function minutes(ms) {
  if (ms === null || ms === undefined) return 'никогда';
  return `${Math.round(ms / 60000)} мин`;
}

function formatAlert(alert, snapshot) {
  switch (alert.kind) {
    case 'dead':
      return `🔴 tg-reader не работает (состояние юнита: ${snapshot.serviceState}). Совпадения сейчас не отслеживаются.`;
    case 'flapping':
      return `🔴 tg-reader перезапускается по кругу: ${snapshot.restarts} перезапусков. Смотрите journalctl -u tg-reader.`;
    case 'stall':
      return `🟠 tg-reader жив, но не видит новых сообщений канала уже ${minutes(snapshot.stateAgeMs)}.`;
    case 'recovered':
      return '🟢 tg-reader снова в норме.';
    case 'digest':
      return `🟢 Сутки без происшествий: проверено ${alert.checkedDelta} сообщений, переслано ${alert.forwardedDelta}.`;
    default:
      return `tg-reader: ${alert.kind}`;
  }
}

module.exports = { formatAlert, minutes };
