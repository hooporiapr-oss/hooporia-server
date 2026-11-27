'use strict';
// Standalone intake only. Not mounted by server.js until a durable inbox exists.
const EVENT_TYPES = new Set([
  'invoice.paid', 'invoice.payment_failed',
  'customer.subscription.updated', 'customer.subscription.deleted',
  'charge.refunded', 'charge.dispute.created'
]);
const idOf = value => typeof value === 'string' ? value : value && value.id;
function subscriptionId(event) {
  const object = event.data && event.data.object;
  if (!object) return null;
  if (event.type.startsWith('customer.subscription.')) return idOf(object);
  return idOf(object.parent?.subscription_details?.subscription) || idOf(object.subscription) || null;
}
function matchesPrice(subscription, priceId) {
  const items = subscription.items?.data;
  if (!Array.isArray(items) || subscription.items.has_more) throw new Error('Incomplete subscription items');
  return items.some(item => idOf(item.price) === priceId);
}
function createWebhook({ stripe, secret, priceId, livemode, inbox, log = console }) {
  if (!stripe?.webhooks?.constructEvent || !stripe?.subscriptions?.retrieve ||
      typeof secret !== 'string' || !secret.startsWith('whsec_') ||
      typeof priceId !== 'string' || !priceId.startsWith('price_') ||
      typeof livemode !== 'boolean' || typeof inbox?.isTracked !== 'function' ||
      typeof inbox?.enqueue !== 'function') throw new Error('Incomplete Ritnome webhook configuration');
  return async function ritnomeWebhook(req, res) {
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
    } catch (_) { return res.status(400).send('Invalid webhook signature'); }
    if (event.livemode !== livemode || event.account) return res.status(400).send('Unexpected Stripe context');
    if (!EVENT_TYPES.has(event.type)) return res.status(200).send('Ignored');
    try {
    const reversal = event.type==='charge.refunded'||event.type==='charge.dispute.created';
    let subId = subscriptionId(event);
    if(reversal){
      const object=event.data?.object;
      const chargeId=event.type==='charge.refunded'?idOf(object):idOf(object?.charge);
      if(!/^ch_[A-Za-z0-9]+$/.test(chargeId||''))return res.status(400).send('Invalid charge reference');
      const charge=await stripe.charges.retrieve(chargeId);
      if(charge.id!==chargeId||charge.livemode!==livemode)throw Error('Charge context mismatch');
      let invoiceId=idOf(charge.invoice);
      if(!invoiceId&&idOf(charge.payment_intent)){
        const pi=await stripe.paymentIntents.retrieve(idOf(charge.payment_intent));
        if(pi.id!==idOf(charge.payment_intent)||pi.livemode!==livemode||idOf(pi.customer)!==idOf(charge.customer))throw Error('Payment context mismatch');
        invoiceId=idOf(pi.invoice);
      }
      if(!invoiceId)return res.status(200).send('Ignored');
      const invoice=await stripe.invoices.retrieve(invoiceId);
      if(invoice.id!==invoiceId||invoice.livemode!==livemode||idOf(invoice.customer)!==idOf(charge.customer))throw Error('Invoice context mismatch');
      subId=idOf(invoice.parent?.subscription_details?.subscription)||idOf(invoice.subscription);
      if(!subId)return res.status(200).send('Ignored');
    }
    if (!subId) {
      // Legitimate one-time invoices are not subscription events.
      if (event.type.startsWith('invoice.')) return res.status(200).send('Ignored');
      return res.status(400).send('Missing subscription reference');
    }
      if (!/^sub_[A-Za-z0-9]+$/.test(subId) || !/^evt_[A-Za-z0-9]+$/.test(event.id) ||
          !Number.isSafeInteger(event.created)) return res.status(400).send('Invalid event reference');
      const tracked = await inbox.isTracked(subId, livemode);
      // Already tracked subscriptions must stay tracked after cancellation or a price change.
      const snapshotMatch = event.type.startsWith('customer.subscription.') &&
        Array.isArray(event.data.object.items?.data) &&
        event.data.object.items.data.some(item => idOf(item.price) === priceId);
      if (!tracked && !snapshotMatch) {
        const current = await stripe.subscriptions.retrieve(subId);
        if (current.id !== subId || current.livemode !== livemode) throw new Error('Subscription context mismatch');
        if (!matchesPrice(current, priceId)) return res.status(200).send('Ignored');
      }
      // Adapter MUST atomically and durably deduplicate by mode + event ID.
      // No license activation at intake. A separate reconciler will re-read Stripe's
      // current state and enforce paid-through periods, quantity and facility binding.
      await inbox.enqueue({
        stripe_event_id: event.id, subscription_id: subId, event_type: event.type,
        event_created: event.created, livemode
      });
      return res.status(200).send('Accepted');
    } catch (_) {
      log.error('Ritnome subscription intake unavailable');
      return res.status(503).send('Retry later');
    }
  };
}
module.exports = { createWebhook, subscriptionId, matchesPrice };
