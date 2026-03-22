import path from 'path';
import { readJsonl } from './jsonl-store.mjs';
import { assessSourceRefs } from './source-discipline.mjs';
import { compilerDirFrom } from './plugin-paths.mjs';

function priorityScore(value) {
  if (value === 'critical') return 40;
  if (value === 'high') return 30;
  if (value === 'medium') return 20;
  return 10;
}
function typeScore(value) {
  if (value === 'dispute-review') return 12;
  if (value === 'promotion-review') return 8;
  return 4;
}
function scoreItem(item) {
  const src = assessSourceRefs(item?.sourceRefs || []);
  const trustedBonus = src.hasTrusted ? 8 : -6;
  const refBonus = Math.min((item?.sourceRefs || []).length, 4);
  const operatorBonus = item?.origin === 'acceptance' || item?.namespace === 'acceptance' || item?.operatorVisible === false ? -20 : 6;
  const sourceDispatchBlockingBonus = item?.sourceDispatchBlocking === true || item?.blockedState === 'source-discipline' ? 28 : 0;
  const requiredDispatchBonus = item?.sourceDispatchRequired === true ? 10 : 0;
  return priorityScore(String(item?.priority || 'low')) + typeScore(String(item?.reviewType || 'review')) + trustedBonus + refBonus + operatorBonus + sourceDispatchBlockingBonus + requiredDispatchBonus;
}

export function triageReviewQueue({ root, limit = 5, status = 'open', query = '', priority, reviewType, includeAcceptance = false, operatorOnly = false, namespace, origin, paths = null }) {
  const compilerDir = compilerDirFrom(root, paths);
  const queuePath = path.join(compilerDir, 'review-queue.jsonl');
  let items = readJsonl(queuePath).filter(x => String(x.status || 'open') === String(status || 'open'));
  if (priority) items = items.filter(x => x.priority === priority);
  if (reviewType) items = items.filter(x => x.reviewType === reviewType);
  if (namespace) items = items.filter(x => (x.namespace || (x.origin === 'acceptance' ? 'acceptance' : 'operator')) === namespace);
  if (origin) items = items.filter(x => (x.origin || 'operator') === origin);
  if (operatorOnly) items = items.filter(x => x.operatorVisible !== false && (x.origin || 'operator') !== 'acceptance' && (x.namespace || 'operator') !== 'acceptance');
  else if (!includeAcceptance) items = items.filter(x => x.operatorVisible !== false || ((x.origin || 'operator') !== 'acceptance' && (x.namespace || 'operator') !== 'acceptance'));
  const q = query ? String(query).toLowerCase() : '';
  if (q) items = items.filter(x => [x.title, x.reason, x.reviewType, x.scope, x.factId].filter(Boolean).some(v => String(v).toLowerCase().includes(q)));

  const grouped = { byPriority: {}, byType: {}, byNamespace: {}, byOrigin: {}, operatorVisible: 0, acceptanceHidden: 0 };
  for (const item of items) {
    grouped.byPriority[item.priority || 'medium'] = (grouped.byPriority[item.priority || 'medium'] || 0) + 1;
    grouped.byType[item.reviewType || 'review'] = (grouped.byType[item.reviewType || 'review'] || 0) + 1;
    const itemNamespace = item.namespace || ((item.origin || 'operator') === 'acceptance' ? 'acceptance' : 'operator');
    const itemOrigin = item.origin || 'operator';
    grouped.byNamespace[itemNamespace] = (grouped.byNamespace[itemNamespace] || 0) + 1;
    grouped.byOrigin[itemOrigin] = (grouped.byOrigin[itemOrigin] || 0) + 1;
    if (item.operatorVisible === false || itemOrigin === 'acceptance' || itemNamespace === 'acceptance') grouped.acceptanceHidden++;
    else grouped.operatorVisible++;
  }

  const ranked = items
    .map(item => ({ ...item, triageScore: scoreItem(item), sourceAssessment: assessSourceRefs(item?.sourceRefs || []) }))
    .sort((a, b) => b.triageScore - a.triageScore || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

  const blockingOperatorItems = ranked.filter(item => (item.sourceDispatchBlocking === true || item.blockedState === 'source-discipline') && item.operatorVisible !== false && (item.origin || 'operator') !== 'acceptance' && (item.namespace || 'operator') !== 'acceptance');
  const topItems = ranked.slice(0, Number(limit || 5));
  const summaryText = topItems.length
    ? topItems.map((item, i) => `${i + 1}. [${item.priority || 'medium'}|${item.reviewType || 'review'}|${item.namespace || item.origin || 'operator'}] ${item.title || item.factId || 'untitled'}${item.targetState ? ` -> ${item.targetState}` : ''}${item.sourceDispatchBlocking === true || item.blockedState === 'source-discipline' ? ' [source-dispatch-blocking]' : ''}${item.sourceAssessment.hasTrusted ? '' : ' (untrusted-source)'}`).join('\n')
    : 'No open review items.';

  const operatorFacing = {
    blockingOpen: blockingOperatorItems.length,
    blockingTop: blockingOperatorItems.slice(0, Number(limit || 5)).map(item => ({
      id: item.id,
      title: item.title || item.factId || 'untitled',
      priority: item.priority || 'medium',
      triageScore: item.triageScore,
      reviewType: item.reviewType || 'review',
      targetState: item.targetState || null,
      sourceDispatchBlocking: item.sourceDispatchBlocking === true || item.blockedState === 'source-discipline',
      sourceDispatchRequired: item.sourceDispatchRequired === true,
      origin: item.origin || 'operator',
      namespace: item.namespace || ((item.origin || 'operator') === 'acceptance' ? 'acceptance' : 'operator'),
    })),
    blockingSummaryText: blockingOperatorItems.length
      ? blockingOperatorItems.slice(0, Number(limit || 5)).map((item, i) => `${i + 1}. [blocking|${item.priority || 'medium'}] ${item.title || item.factId || 'untitled'} -> ${item.targetState || 'unknown'} (score=${item.triageScore})`).join('\n')
      : 'No operator-visible source-dispatch blocking items.',
  };

  return { ok: true, total: items.length, grouped, topItems, summaryText, operatorFacing };
}
