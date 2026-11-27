'use strict';
// Protected institutional activity desk. No resident records; no payment secrets.
const plans=[
 {id:'gentle',es:'Ritmo suave · 15 min',en:'Gentle rhythm · 15 min',steps:[{minutes:3,es:'Bienvenida y ritmo cómodo',en:'Welcome and comfortable rhythm'},{minutes:5,es:'Palmadas o toques al ritmo elegido, sentados si prefieren',en:'Clap or tap at a comfortable pace, seated if preferred'},{minutes:5,es:'Juego recreativo de ritmo en grupo',en:'Group rhythm recreation game'},{minutes:2,es:'Cierre y descanso',en:'Cool down and rest'}]},
 {id:'social',es:'Ritmo y convivencia · 25 min',en:'Rhythm and connection · 25 min',steps:[{minutes:5,es:'Bienvenida y selección del ritmo',en:'Welcome and rhythm selection'},{minutes:7,es:'Conga Party con turnos voluntarios',en:'Conga Party with optional turns'},{minutes:10,es:'Juego recreativo a elección del grupo',en:'Group-selected recreation game'},{minutes:3,es:'Cierre y descanso',en:'Cool down and rest'}]}
];
function createActivityDesk(gate){
 return async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
   const access=await gate.authorize(req.headers?.authorization);
   if(!access.allowed)return res.status(access.status).json({allowed:false});
   return res.status(200).json({allowed:true,plans,notice:{es:'Adapta la actividad a la comodidad de cada participante. Participación voluntaria. No es terapia.',en:'Adapt activities to each participant’s comfort. Participation is voluntary. Not therapy.'}});
  }catch{return res.status(503).json({allowed:false});}
 };
}
module.exports={createActivityDesk};
