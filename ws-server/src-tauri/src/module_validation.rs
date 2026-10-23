//! Current envelopes are data only. Unknown configurations are bounded and retained.
use serde_json::{json,Value};
use std::{collections::HashSet,sync::LazyLock};
static SCHEMA:LazyLock<Value>=LazyLock::new(||serde_json::from_str(include_str!("../schema/studio-current.json")).unwrap());
static DEFINITIONS:LazyLock<Value>=LazyLock::new(||serde_json::from_str(include_str!("../schema/module-configurations.json")).unwrap());
fn bounded_json(v:&Value,depth:usize,nodes:&mut usize)->bool{
 *nodes+=1;if *nodes>10000||depth>16{return false;}
 match v{
  Value::String(s)=>s.encode_utf16().count()<=16384&&crate::studio_validation::valid_text(s),
  Value::Array(a)=>a.len()<=1000&&a.iter().all(|v|bounded_json(v,depth+1,nodes)),
  Value::Object(o)=>o.len()<=256&&o.iter().all(|(key,v)|key.encode_utf16().count()<=100&&crate::studio_validation::valid_text(key)&&!matches!(key.as_str(),"__proto__"|"prototype"|"constructor")&&bounded_json(v,depth+1,nodes)),
  _=>true,
 }
}
fn references(m:&Value)->(HashSet<String>,HashSet<String>){
 let mut assets=HashSet::new();let mut shapes=HashSet::new();
 if let Some(id)=m["image"]["assetId"].as_str().filter(|s|!s.is_empty()){assets.insert(id.to_owned());}
 if let Some(id)=m["mouseBodyShapeId"].as_str().filter(|s|!s.is_empty()){shapes.insert(id.to_owned());}
 for style in std::iter::once(&m["appearance"]).chain(m["keys"].as_array().into_iter().flatten().map(|key|&key["style"])).chain(m["buttonStyles"].as_object().into_iter().flat_map(|o|o.values())){
  if let Some(id)=style["shapeId"].as_str().filter(|s|!s.is_empty()){shapes.insert(id.to_owned());}
 }
 (assets,shapes)
}
pub fn valid(d:&Value)->bool{
 use crate::studio_validation::validate;
 if !validate(d,&SCHEMA)||serde_json::to_vec(d).map_or(true,|bytes|bytes.len()>1_800_000){return false;}
 let mut canonical=d.clone();let mut candidate=d.clone();candidate["version"]=json!(4);
 let seed:Value=serde_json::from_str(include_str!("../schema/default-model.json")).unwrap();
 for key in ["profiles","presets"]{
  for (index,p) in d[key].as_array().unwrap().iter().enumerate(){
   let mut modules=Vec::new();
   for (module_index,m) in p["modules"].as_array().unwrap().iter().enumerate(){
    if !m["config"].is_object()||!bounded_json(&m["config"],0,&mut 0)||serde_json::to_vec(&m["config"]).map_or(true,|bytes|bytes.len()>262144){return false;}
    if m["common"]["x"].as_f64().unwrap()+m["common"]["w"].as_f64().unwrap()>1920.||m["common"]["y"].as_f64().unwrap()+m["common"]["h"].as_f64().unwrap()>1080.{return false;}
    let resource_set=|kind:&str,library:&str|->Option<HashSet<String>>{
     let ids=m["resources"][kind].as_array()?;let mut set=HashSet::new();
     for id in ids{let id=id.as_str()?;if d[library].get(id).is_none()||!set.insert(id.to_owned()){return None;}}
     Some(set)
    };
    let (Some(assets),Some(shapes))=(resource_set("assets","assets"),resource_set("shapes","shapes"))else{return false;};
    let definition=&DEFINITIONS[m["type"].as_str().unwrap()];
    let known=definition["schemaVersion"]==m["schemaVersion"]&&!definition.is_null();
    let mut flat=if known{
     if !validate(&m["config"],&definition["schema"]){return false;}let mut config=m["config"].clone();crate::studio_validation::apply_defaults(&mut config,&definition["schema"]);canonical[key][index]["modules"][module_index]["config"]=config.clone();config["type"]=definition["builtinType"].clone();config
    }else{seed["profiles"][0]["modules"][3].clone()};
    flat.as_object_mut().unwrap().extend(m["common"].as_object().unwrap().clone());flat["id"]=m["id"].clone();
    if known&&references(&flat)!=(assets,shapes){return false;}
    modules.push(flat);
   }
   candidate[key][index]["modules"]=json!(modules);
  }
 }
 serde_json::to_vec(&canonical).is_ok_and(|bytes|bytes.len()<=1_800_000)&&crate::studio_validation::valid_projection(&candidate)
}

#[cfg(test)]
mod tests{
 use super::*;
 #[test]
 fn compact_inactive_modules_are_not_limited_by_their_internal_projection(){
  let mut document:Value=serde_json::from_str(include_str!("../schema/default-current.json")).unwrap();
  let seed=json!({"id":"opaque-0","type":"test.future","schemaVersion":1,"enabled":false,"common":document["profiles"][0]["modules"][3]["common"],"config":{},"resources":{"assets":[],"shapes":[]}});
  let mut profiles=Vec::new();for i in 0..50{let mut profile=document["profiles"][0].clone();profile["id"]=json!(format!("profile-{i}"));profile["modules"]=json!((0..32).map(|j|{let mut module=seed.clone();module["id"]=json!(format!("opaque-{j}"));module}).collect::<Vec<_>>());profiles.push(profile);}
  document["profiles"]=json!(profiles);document["activeProfileId"]=json!("profile-0");assert!(serde_json::to_vec(&document).unwrap().len()<1_800_000);assert!(crate::studio_validation::valid_document(&document));
 }
 #[test]
 fn shared_frontend_native_corpus_has_identical_acceptance(){
  let cases:Value=serde_json::from_str(include_str!("../test-fixtures/modules-current.json")).unwrap();
  for case in cases.as_array().unwrap(){assert_eq!(crate::studio_validation::valid_document(&case["document"]),case["valid"].as_bool().unwrap(),"{}",case["name"]);}
 }
}
