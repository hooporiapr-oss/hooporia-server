'use strict';
// Institutional activity catalog. The activity key chooses the host and path; the browser never supplies a URL.
// `available` is false until the activity's integration and reporting have been verified (owner rule: do not advertise before that).
const activities=[
 {key:'conga-party',es:'Conga Party',en:'Conga Party',category:'rhythm',origin:'https://ritnome.com',path:'/conga-party.html',mode:'group',seated:true,minutes:15,available:true,flagship:true},
 {key:'lelolai-letras',es:'LeLoLai Letras',en:'LeLoLai Letras',category:'recreation',origin:'https://ritnome.com',path:'/recreation-sopa.html',mode:'individual',seated:true,minutes:10,available:false},
 {key:'la-marquesina',es:'La Marquesina (dominó)',en:'La Marquesina (dominoes)',category:'recreation',origin:'https://ritnome.com',path:'/recreation-domino.html',mode:'group',seated:true,minutes:15,available:false},
 {key:'solitario-boricua',es:'Solitario Boricua',en:'Boricua Solitaire',category:'recreation',origin:'https://ritnome.com',path:'/recreation-solitario.html',mode:'individual',seated:true,minutes:10,available:false},
 {key:'la-isla',es:'La Isla (rompecabezas)',en:'La Isla (puzzles)',category:'recreation',origin:'https://ritnome.com',path:'/recreation-isla.html',mode:'individual',seated:true,minutes:10,available:false},
 {key:'reaction-speed',es:'Reaction Speed',en:'Reaction Speed',category:'reaction',origin:'https://vreaction.com',path:'/vr-reaction-speed.html',mode:'individual',seated:true,minutes:5,available:false},
 {key:'zona',es:'Zona',en:'Zona',category:'reaction',origin:'https://vreaction.com',path:'/vr-zona.html',mode:'individual',seated:true,minutes:5,available:false},
 {key:'zona-roja',es:'Zona Roja',en:'Zona Roja',category:'reaction',origin:'https://vreaction.com',path:'/vr-zona-roja.html',mode:'individual',seated:true,minutes:5,available:false},
 {key:'swipe-it',es:'Swipe It',en:'Swipe It',category:'reaction',origin:'https://vreaction.com',path:'/vr-swipe-it.html',mode:'individual',seated:true,minutes:5,available:false},
 {key:'reactific',es:'Reactific',en:'Reactific',category:'reaction',origin:'https://vreaction.com',path:'/vr-reactific.html',mode:'individual',seated:true,minutes:5,available:false},
 {key:'encadena',es:'Encadena',en:'Encadena',category:'memory',origin:'https://vreaction.com',path:'/vr-encadena.html',mode:'group',seated:true,minutes:10,available:false},
 {key:'recall',es:'Recall',en:'Recall',category:'memory',origin:'https://hooporia.mobi',path:'/002-recall.html',mode:'individual',seated:true,minutes:5,available:false},
 {key:'recognition',es:'Recognition',en:'Recognition',category:'memory',origin:'https://hooporia.mobi',path:'/003-recognition.html',mode:'individual',seated:true,minutes:5,available:false},
 {key:'replay',es:'Replay',en:'Replay',category:'memory',origin:'https://hooporia.mobi',path:'/004-replay.html',mode:'individual',seated:true,minutes:5,available:false},
 {key:'the-fortress',es:'The Fortress',en:'The Fortress',category:'memory',origin:'https://hooporia.mobi',path:'/001-fortress.html',mode:'individual',seated:true,minutes:5,available:false},
 {key:'the-reset',es:'The Reset',en:'The Reset',category:'rhythm',origin:'https://hooporia.mobi',path:'/005-reset.html',mode:'group',seated:true,minutes:3,available:false}
];
const categories={rhythm:{es:'Ritmo y música',en:'Rhythm and music'},recreation:{es:'Recreación puertorriqueña',en:'Puerto Rican recreation'},reaction:{es:'Reacción y coordinación',en:'Reaction and coordination'},memory:{es:'Memoria y reconocimiento',en:'Memory and recognition'}};
const origins=[...new Set(activities.map(a=>a.origin))];
const byKey=new Map(activities.map(a=>[a.key,a]));
module.exports={activities,categories,origins,byKey};
