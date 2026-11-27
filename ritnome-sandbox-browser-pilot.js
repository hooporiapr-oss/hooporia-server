'use strict';
// One explicitly enabled synthetic browser fixture; no credentials in source or logs.
async function prepareBrowserPilot(base,password){
 if(typeof password!=='string'||password.length<24)throw Error('Sandbox pilot requires strong temporary password');
 const email='ritnome-browser-pilot@example.invalid';
 const made=await base.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{ritnome_sandbox_fixture:true}});
 if(made.error||made.data?.user?.email!==email||!made.data.user.id)throw Error('Sandbox pilot user creation failed');
 const uid=made.data.user.id;
 const ins=await base.from('ritnome_enrollment').insert({livemode:false,owner_id:uid,facility_name:'RITNOME BROWSER PILOT - TEST ONLY',facility_type:'residence'});
 if(ins.error){await base.auth.admin.deleteUser(uid);throw Error('Sandbox pilot enrollment failed');}
}
module.exports={prepareBrowserPilot};
