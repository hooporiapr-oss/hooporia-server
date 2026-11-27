'use strict';
// Institutional policy only. Not a public route or authentication mechanism.
// Caller must authenticate the institution and establish its license identity independently.
function evaluateInstitutionAccess({binding,license,facilityId,priceId,now=Date.now()}){
 const deny=reason=>({allowed:false,reason});
 if(!Number.isSafeInteger(now)||now<=0)throw Error('Invalid clock');
 if(!binding||binding.livemode!==true)return deny('no_live_binding');
 if(typeof facilityId!=='string'||!facilityId||binding.facility_id!==facilityId)return deny('facility_mismatch');
 if(typeof priceId!=='string'||!priceId||binding.stripe_price_id!==priceId)return deny('price_mismatch');
 if(!license||!binding.license_id||binding.license_id!==license.id)return deny('license_mismatch');
 if(license.product!=='ritnome_institutional'||license.active!==true)return deny('license_inactive_or_wrong_product');
 if(!['active','past_due','unpaid','canceled'].includes(binding.billing_status))return deny('billing_review_or_ineligible');
 const end=Date.parse(binding.paid_through);
 if(!Number.isFinite(end)||end<=now)return deny('paid_period_expired');
 // Respect a separately imposed manual license expiry, when supplied.
 // Date-only expiry is inclusive through UTC day; exact billing timestamp remains authoritative.
 if(license.expires_at!=null){
  if(typeof license.expires_at!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(license.expires_at))return deny('invalid_license_expiry');
  const day=Date.parse(license.expires_at+'T00:00:00Z');
  if(!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==license.expires_at||now>=day+86400000)return deny('manual_license_expired');
 }
 return {allowed:true,reason:'current_paid_period',paidThrough:new Date(end).toISOString()};
}
module.exports={evaluateInstitutionAccess};
