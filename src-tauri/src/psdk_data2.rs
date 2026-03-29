//! Lecture de `Data/2.dat` (PSDK) : extraction de la liste des noms d’espèces en français,
//! indexée par l’ID interne (même index que `pokemon.id` / GTS).

use std::collections::HashMap;
use std::path::Path;

#[derive(Clone, Debug)]
#[allow(dead_code)]
enum RbValue {
    Nil,
    Bool(bool),
    Int(i64),
    String(String),
    Symbol(String),
    Array(Vec<RbValue>),
    Hash(Vec<(RbValue, RbValue)>),
    Object { class: String, ivars: Vec<(String, RbValue)> },
}

struct MarshalReader<'a> {
    data: &'a [u8],
    pub pos: usize,
    symbols: Vec<String>,
    objects: Vec<RbValue>,
}

impl<'a> MarshalReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self {
            data,
            pos: 0,
            symbols: Vec::new(),
            objects: Vec::new(),
        }
    }

    fn read_byte(&mut self) -> Result<u8, ()> {
        let b = *self.data.get(self.pos).ok_or(())?;
        self.pos += 1;
        Ok(b)
    }

    fn read_fixnum(&mut self) -> Result<i64, ()> {
        let c = self.read_byte()? as i32;
        if c == 0 {
            return Ok(0);
        }
        if (5..=127).contains(&c) {
            return Ok((c - 5) as i64);
        }
        if c >= 128 {
            let c = c - 256;
            if (-128..=-5).contains(&c) {
                return Ok((c + 5) as i64);
            }
        }
        if (1..=4).contains(&c) {
            let size = c as usize;
            let mut n: i64 = 0;
            for i in 0..size {
                n |= (self.read_byte()? as i64) << (8 * i);
            }
            return Ok(n);
        }
        if (-4..=-1).contains(&c) {
            let size = (-c) as usize;
            let mut n: i64 = 0;
            for i in 0..size {
                n |= (self.read_byte()? as i64) << (8 * i);
            }
            let mask = (1i64 << (size * 8)) - 1;
            n ^= mask;
            n = -n - 1;
            return Ok(n);
        }
        Err(())
    }

    fn read_string_raw(&mut self) -> Result<Vec<u8>, ()> {
        let len = self.read_fixnum()?;
        if len < 0 || len > 1_000_000 {
            return Err(());
        }
        let len = len as usize;
        let end = self.pos.checked_add(len).ok_or(())?;
        let slice = self.data.get(self.pos..end).ok_or(())?;
        self.pos = end;
        Ok(slice.to_vec())
    }

    fn read_string(&mut self) -> Result<RbValue, ()> {
        let raw = self.read_string_raw()?;
        let s = String::from_utf8_lossy(&raw).into_owned();
        let v = RbValue::String(s);
        self.objects.push(v.clone());
        Ok(v)
    }

    fn read_symbol(&mut self) -> Result<RbValue, ()> {
        let raw = self.read_string_raw()?;
        let s = String::from_utf8_lossy(&raw).into_owned();
        self.symbols.push(s.clone());
        Ok(RbValue::Symbol(s))
    }

    fn read_symbol_link(&mut self) -> Result<RbValue, ()> {
        let idx = self.read_fixnum()?;
        if idx < 0 || idx as usize >= self.symbols.len() {
            return Err(());
        }
        Ok(RbValue::Symbol(self.symbols[idx as usize].clone()))
    }

    fn read_object_link(&mut self) -> Result<RbValue, ()> {
        let idx = self.read_fixnum()?;
        if idx < 0 || idx as usize >= self.objects.len() {
            // Tolérant : référence invalide → Nil au lieu d'erreur
            return Ok(RbValue::Nil);
        }
        Ok(self.objects[idx as usize].clone())
    }

    fn read_array(&mut self) -> Result<RbValue, ()> {
        let len = self.read_fixnum()?;
        if len < 0 || len > 2_000_000 {
            return Err(());
        }
        let len = len as usize;
        let mut arr: Vec<RbValue> = Vec::with_capacity(len);
        for _ in 0..len {
            arr.push(self.read()?);
        }
        let v = RbValue::Array(arr.clone());
        self.objects.push(v.clone());
        Ok(v)
    }

    fn read_instance_var(&mut self) -> Result<RbValue, ()> {
        let base = self.read()?;
        let n = self.read_fixnum()?;
        if n < 0 || n > 1000 {
            return Err(());
        }
        for _ in 0..n {
            let _key = self.read()?;
            let _val = self.read()?;
        }
        Ok(base)
    }

    fn read_hash(&mut self) -> Result<RbValue, ()> {
        let len = self.read_fixnum()?;
        if len < 0 || len > 500_000 {
            return Err(());
        }
        let mut pairs = Vec::with_capacity(len as usize);
        for _ in 0..len {
            let k = self.read()?;
            let v = self.read()?;
            pairs.push((k, v));
        }
        let val = RbValue::Hash(pairs);
        self.objects.push(val.clone());
        Ok(val)
    }

    fn read_object(&mut self) -> Result<RbValue, ()> {
        // 'o' : class_symbol ivar_count (sym val)*
        let class_sym = self.read()?;
        let class_name = match class_sym {
            RbValue::Symbol(ref s) => s.clone(),
            _ => String::new(),
        };
        let n = self.read_fixnum()?;
        if n < 0 || n > 1000 {
            return Err(());
        }
        let mut ivars: Vec<(String, RbValue)> = Vec::with_capacity(n as usize);
        // Reserve an object slot first (for back-references)
        let obj_idx = self.objects.len();
        self.objects.push(RbValue::Nil);
        for _ in 0..n {
            let key = self.read()?;
            let key_name = match key {
                RbValue::Symbol(s) => s,
                _ => String::new(),
            };
            let val = self.read()?;
            ivars.push((key_name, val));
        }
        let obj = RbValue::Object { class: class_name, ivars };
        self.objects[obj_idx] = obj.clone();
        Ok(obj)
    }

    fn read_user_defined(&mut self) -> Result<RbValue, ()> {
        // 'u' : class_symbol data_string — skip it
        let _class = self.read()?;
        let _data = self.read_string_raw()?;
        let v = RbValue::Nil;
        self.objects.push(v.clone());
        Ok(v)
    }

    fn read_user_class(&mut self) -> Result<RbValue, ()> {
        // 'C' : class_symbol wrapped_value
        // The inner value registers itself; C is transparent
        let _class = self.read()?;
        let val = self.read()?;
        Ok(val)
    }

    fn read_float(&mut self) -> Result<RbValue, ()> {
        // 'f' : string_repr_of_float
        let raw = self.read_string_raw()?;
        let s = String::from_utf8_lossy(&raw);
        let f = s.parse::<f64>().unwrap_or(0.0);
        let v = RbValue::Int(f as i64); // approximate as Int
        self.objects.push(v.clone());
        Ok(v)
    }

    fn read_bignum(&mut self) -> Result<RbValue, ()> {
        // 'l' : sign_byte length_fixnum data_bytes
        let sign = self.read_byte()?;
        let len = self.read_fixnum()?;
        if len < 0 || len > 100 {
            return Err(());
        }
        let byte_count = (len as usize) * 2;
        let mut n: i64 = 0;
        for i in 0..byte_count.min(8) {
            n |= (self.read_byte()? as i64) << (8 * i);
        }
        // Skip remaining bytes for very large bignums
        for _ in 8..byte_count {
            let _ = self.read_byte()?;
        }
        if sign == b'-' {
            n = -n;
        }
        let v = RbValue::Int(n);
        self.objects.push(v.clone());
        Ok(v)
    }

    fn read(&mut self) -> Result<RbValue, ()> {
        let code = self.read_byte()?;
        match code {
            b'0' => Ok(RbValue::Nil),
            b'T' => Ok(RbValue::Bool(true)),
            b'F' => Ok(RbValue::Bool(false)),
            b'i' => Ok(RbValue::Int(self.read_fixnum()?)),
            b':' => self.read_symbol(),
            b';' => self.read_symbol_link(),
            b'@' => self.read_object_link(),
            b'[' => self.read_array(),
            b'{' => self.read_hash(),
            b'o' => self.read_object(),
            b'u' => self.read_user_defined(),
            b'C' => self.read_user_class(),
            b'f' => self.read_float(),
            b'l' => self.read_bignum(),
            b'"' => self.read_string(),
            b'I' => self.read_instance_var(),
            _ => Err(()),
        }
    }
}

fn rb_array_to_strings(v: RbValue) -> Option<Vec<String>> {
    let RbValue::Array(items) = v else {
        return None;
    };
    let mut out = Vec::with_capacity(items.len());
    for it in items {
        match it {
            RbValue::String(s) => out.push(s),
            _ => return None,
        }
    }
    Some(out)
}

/// Repère la table des noms français d’attaques (text_get(6, id)).
/// Heuristique : « Surf » à l’index 57 (identique en FR/EN, très fiable).
fn find_french_skill_names(data: &[u8]) -> Option<Vec<String>> {
    let mut i = 0usize;
    while i + 2 < data.len() {
        if data[i] == 0x04 && data[i + 1] == 0x08 {
            let mut r = MarshalReader::new(&data[i + 2..]);
            if let Ok(val) = r.read() {
                if let Some(arr) = rb_array_to_strings(val) {
                    let n = arr.len();
                    // La table d’attaques a ~800-1100 entrées et contient « Surf » à l’index 57.
                    // « Surf » est identique dans toutes les langues, donc on vérifie aussi
                    // l’attaque #1 = « Écras’Face » (FR) pour ne pas confondre avec ES/EN/etc.
                    if (400..=2500).contains(&n) {
                        if arr.get(57).map(|s| s.as_str()) == Some("Surf")
                            && arr.get(1).map(|s| s.contains("cras")).unwrap_or(false)
                        {
                            return Some(arr);
                        }
                    }
                }
            }
        }
        i += 1;
    }
    None
}

/// Repère la table des noms français (liste d’environ 1017 chaînes, index = ID interne).
fn find_french_species_names(data: &[u8]) -> Option<Vec<String>> {
    let mut i = 0usize;
    while i + 2 < data.len() {
        if data[i] == 0x04 && data[i + 1] == 0x08 {
            let mut r = MarshalReader::new(&data[i + 2..]);
            if let Ok(val) = r.read() {
                if let Some(arr) = rb_array_to_strings(val) {
                    let n = arr.len();
                    if (500..=2500).contains(&n) {
                        if arr.get(479).map(|s| s.as_str()) == Some("Motisma")
                            || (arr.first().map(|s| s.contains("uf")).unwrap_or(false) && n >= 900)
                        {
                            return Some(arr);
                        }
                    }
                }
            }
        }
        i += 1;
    }
    None
}

/// Repère la table des noms français de talents/capacités (abilities).
/// Heuristique : ~291 entrées, « Puanteur » à l’index 1 (FR pour Stench).
fn find_french_ability_names(data: &[u8]) -> Option<Vec<String>> {
    let mut i = 0usize;
    while i + 2 < data.len() {
        if data[i] == 0x04 && data[i + 1] == 0x08 {
            let mut r = MarshalReader::new(&data[i + 2..]);
            if let Ok(val) = r.read() {
                if let Some(arr) = rb_array_to_strings(val) {
                    let n = arr.len();
                    if (150..=600).contains(&n) {
                        if arr.get(1).map(|s| s.as_str()) == Some("Puanteur")
                            && arr.get(22).map(|s| s.as_str()) == Some("Intimidation")
                        {
                            return Some(arr);
                        }
                    }
                }
            }
        }
        i += 1;
    }
    None
}

/// Repère la table des noms français d’objets (singulier).
/// Heuristique : ~1077 entrées, « Hyper Ball » à l’index 2 (FR pour Ultra Ball).
fn find_french_item_names(data: &[u8]) -> Option<Vec<String>> {
    let mut i = 0usize;
    while i + 2 < data.len() {
        if data[i] == 0x04 && data[i + 1] == 0x08 {
            let mut r = MarshalReader::new(&data[i + 2..]);
            if let Ok(val) = r.read() {
                if let Some(arr) = rb_array_to_strings(val) {
                    let n = arr.len();
                    // Table d’objets au singulier : ~1077 entrées, « Hyper Ball » à l’index 2,
                    // « Super Ball » à l’index 3, avg_len ~10.
                    if (500..=3000).contains(&n) {
                        if arr.get(2).map(|s| s.as_str()) == Some("Hyper Ball")
                            && arr.get(3).map(|s| s.as_str()) == Some("Super Ball")
                        {
                            return Some(arr);
                        }
                    }
                }
            }
        }
        i += 1;
    }
    None
}

/// Lit les noms d’attaques français depuis `Data/2.dat`.
pub fn read_french_skill_names(game_root: &Path) -> Result<Vec<String>, String> {
    let path = game_root.join("Data").join("2.dat");
    if !path.is_file() {
        return Err(format!("Fichier introuvable : {}", path.display()));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    find_french_skill_names(&bytes).ok_or_else(|| {
        "Impossible de lire la table des noms d’attaques (Marshal) dans Data/2.dat.".into()
    })
}

/// Lit les noms de talents français depuis `Data/2.dat`.
pub fn read_french_ability_names(game_root: &Path) -> Result<Vec<String>, String> {
    let path = game_root.join("Data").join("2.dat");
    if !path.is_file() {
        return Err(format!("Fichier introuvable : {}", path.display()));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    find_french_ability_names(&bytes).ok_or_else(|| {
        "Impossible de lire la table des noms de talents (Marshal) dans Data/2.dat.".into()
    })
}

/// Lit les noms d’objets français (singulier) depuis `Data/2.dat`.
pub fn read_french_item_names(game_root: &Path) -> Result<Vec<String>, String> {
    let path = game_root.join("Data").join("2.dat");
    if !path.is_file() {
        return Err(format!("Fichier introuvable : {}", path.display()));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    find_french_item_names(&bytes).ok_or_else(|| {
        "Impossible de lire la table des noms d’objets (Marshal) dans Data/2.dat.".into()
    })
}

/// Repère la table des noms de zones français (text_get pour les panneaux de carte).
/// Heuristique : ~378 entrées, « Route 1 » à l’index 3, « Argenta » à l’index 7.
fn find_french_zone_names(data: &[u8]) -> Option<Vec<String>> {
    let mut i = 0usize;
    while i + 2 < data.len() {
        if data[i] == 0x04 && data[i + 1] == 0x08 {
            let mut r = MarshalReader::new(&data[i + 2..]);
            if let Ok(val) = r.read() {
                if let Some(arr) = rb_array_to_strings(val) {
                    let n = arr.len();
                    if (100..=1000).contains(&n) {
                        if arr.get(3).map(|s| s.as_str()) == Some("Route 1")
                            && arr.get(7).map(|s| s.as_str()) == Some("Argenta")
                        {
                            return Some(arr);
                        }
                    }
                }
            }
        }
        i += 1;
    }
    None
}

/// Lit les noms de zones français depuis `Data/2.dat`.
pub fn read_french_zone_names(game_root: &Path) -> Result<Vec<String>, String> {
    let path = game_root.join("Data").join("2.dat");
    if !path.is_file() {
        return Err(format!("Fichier introuvable : {}", path.display()));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    find_french_zone_names(&bytes).ok_or_else(|| {
        "Impossible de lire la table des noms de zones (Marshal) dans Data/2.dat.".into()
    })
}

/// Lit `mapdata.rxdata` depuis `Data/3.dat` (VD) et construit un mapping map_id -> panel_id.
pub fn read_map_to_zone(game_root: &Path) -> Result<HashMap<u32, u32>, String> {
    let path = game_root.join("Data").join("3.dat");
    if !path.is_file() {
        return Err(format!("Fichier introuvable : {}", path.display()));
    }
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    if data.len() < 8 {
        return Err("3.dat trop petit".into());
    }

    // Lire le pointeur d’index VD
    let index_ptr = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
    if index_ptr + 2 >= data.len() || data[index_ptr] != 0x04 || data[index_ptr + 1] != 0x08 {
        return Err("Index VD invalide dans 3.dat".into());
    }

    // Parser l’index VD pour trouver mapdata.rxdata
    let idx_bytes = &data[index_ptr + 2..];
    let mapdata_offset = find_vd_entry_offset(idx_bytes, "mapdata.rxdata")
        .ok_or_else(|| "mapdata.rxdata introuvable dans 3.dat".to_string())?;

    // Lire l’entrée VD : 4 octets taille + données
    if mapdata_offset + 4 > data.len() {
        return Err("Offset mapdata invalide".into());
    }
    let entry_size = u32::from_le_bytes([
        data[mapdata_offset],
        data[mapdata_offset + 1],
        data[mapdata_offset + 2],
        data[mapdata_offset + 3],
    ]) as usize;
    let entry_start = mapdata_offset + 4;
    let entry_end = entry_start + entry_size;
    if entry_end > data.len() {
        return Err("Données mapdata tronquées".into());
    }
    let mapdata_bytes = &data[entry_start..entry_end];
    if mapdata_bytes.len() < 2 || mapdata_bytes[0] != 0x04 || mapdata_bytes[1] != 0x08 {
        return Err("Marshal header invalide pour mapdata".into());
    }

    // Parser le Marshal : c’est un Array[nil, Array[GameData::Map, ...]]
    // On cherche les ivars @map_id et @panel_id dans chaque objet
    parse_mapdata_marshal(&mapdata_bytes[2..])
}

/// Cherche un fichier dans l’index VD (Marshal Hash) et retourne son offset.
fn find_vd_entry_offset(idx_bytes: &[u8], filename: &str) -> Option<usize> {
    // L’index est un Hash Ruby sérialisé : { "nom" => offset_int, ... }
    let mut r = MarshalReader::new(idx_bytes);
    if let Ok(val) = r.read() {
        if let RbValue::Array(pairs) = val {
            // Le MarshalReader lit les Hash comme des arrays alternant clé/valeur ?
            // Non, il ne supporte pas les Hash directement.
            // Fallback: scan brut.
            let _ = pairs;
        }
    }
    // Fallback: chercher le nom de fichier en brut dans l’index puis lire le fixnum qui suit
    find_vd_entry_offset_brute(idx_bytes, filename)
}

fn find_vd_entry_offset_brute(idx_bytes: &[u8], filename: &str) -> Option<usize> {
    let needle = filename.as_bytes();
    for i in 0..idx_bytes.len().saturating_sub(needle.len()) {
        if &idx_bytes[i..i + needle.len()] == needle {
            // Après le nom de fichier, il y a les ivars (encoding) puis ‘i’ + fixnum
            let search_start = i + needle.len();
            let search_end = (search_start + 20).min(idx_bytes.len());
            for j in search_start..search_end {
                if idx_bytes[j] == 0x69 {
                    // read() attend le code byte ‘i’ puis le fixnum
                    let mut r = MarshalReader::new(&idx_bytes[j..]);
                    if let Ok(RbValue::Int(offset)) = r.read() {
                        if offset >= 0 {
                            return Some(offset as usize);
                        }
                    }
                }
            }
        }
    }
    None
}

/// Parse le contenu Marshal de mapdata.rxdata pour extraire map_id -> panel_id.
/// Structure : Array[nil, Array[GameData::Map, ...]]
fn parse_mapdata_marshal(bytes: &[u8]) -> Result<HashMap<u32, u32>, String> {
    let mut r = MarshalReader::new(bytes);
    let val = r.read().map_err(|_| {
        format!("Erreur de parsing Marshal mapdata à pos={}, byte=0x{:02x}",
            r.pos, bytes.get(r.pos.saturating_sub(1)).copied().unwrap_or(0))
    })?;

    let outer = match val {
        RbValue::Array(a) => a,
        _ => return Err("mapdata: attendu Array en racine".into()),
    };

    // L’élément [1] est le Array d’objets GameData::Map
    let maps_arr = match outer.get(1) {
        Some(RbValue::Array(a)) => a,
        _ => return Err("mapdata[1]: attendu Array".into()),
    };

    let mut result = HashMap::new();
    for entry in maps_arr {
        if let RbValue::Object { ivars, .. } = entry {
            let mut map_ids: Vec<i64> = Vec::new();
            let mut panel_id: Option<i64> = None;

            for (name, val) in ivars {
                match name.as_str() {
                    "@map_id" => match val {
                        RbValue::Int(n) => map_ids.push(*n),
                        RbValue::Array(arr) => {
                            for item in arr {
                                if let RbValue::Int(n) = item {
                                    map_ids.push(*n);
                                }
                            }
                        }
                        _ => {}
                    },
                    "@panel_id" => {
                        if let RbValue::Int(n) = val {
                            panel_id = Some(*n);
                        }
                    }
                    _ => {}
                }
            }

            if let Some(pid) = panel_id {
                for mid in &map_ids {
                    if *mid >= 0 {
                        result.insert(*mid as u32, pid as u32);
                    }
                }
            }
        }
    }

    if result.is_empty() {
        Err("Aucun mapping map_id -> panel_id trouvé dans mapdata".into())
    } else {
        Ok(result)
    }
}

/// Lit `Data/2.dat` à partir du dossier d’installation du jeu.
pub fn read_french_species_names(game_root: &Path) -> Result<Vec<String>, String> {
    let path = game_root.join("Data").join("2.dat");
    if !path.is_file() {
        return Err(format!(
            "Fichier introuvable : {}",
            path.display()
        ));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    find_french_species_names(&bytes).ok_or_else(|| {
        "Impossible de lire la table des noms (Marshal) dans Data/2.dat.".into()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn game_data2_path() -> Option<PathBuf> {
        let candidates = [
            PathBuf::from(r"C:\Users\lamou\AppData\Local\PNW Launcher\Game"),
            PathBuf::from(r"C:\Program Files\PNW Launcher\Game"),
        ];
        for root in candidates {
            let p = root.join("Data").join("2.dat");
            if p.is_file() {
                return Some(p);
            }
        }
        None
    }

    #[test]
    fn parse_data2_if_game_installed() {
        let p = match game_data2_path() {
            Some(p) => p,
            None => return,
        };
        let bytes = std::fs::read(&p).unwrap();
        let names = find_french_species_names(&bytes).expect("parse");
        assert!(
            names.len() > 900,
            "liste trop courte: {}",
            names.len()
        );
        assert_eq!(names.get(479).map(|s| s.as_str()), Some("Motisma"));
        assert_eq!(names.get(954).map(|s| s.as_str()), Some("Phaston"));
    }

    #[test]
    fn parse_data2_abilities_if_game_installed() {
        let p = match game_data2_path() {
            Some(p) => p,
            None => return,
        };
        let bytes = std::fs::read(&p).unwrap();
        let names = find_french_ability_names(&bytes).expect("ability names parse");
        assert!(names.len() > 100, "liste trop courte: {}", names.len());
        assert_eq!(names.get(1).map(|s| s.as_str()), Some("Puanteur"));
        assert_eq!(names.get(22).map(|s| s.as_str()), Some("Intimidation"));
    }

    #[test]
    fn parse_data2_items_if_game_installed() {
        let p = match game_data2_path() {
            Some(p) => p,
            None => return,
        };
        let bytes = std::fs::read(&p).unwrap();
        let names = find_french_item_names(&bytes).expect("item names parse");
        assert!(names.len() > 500, "liste trop courte: {}", names.len());
        assert_eq!(names.get(2).map(|s| s.as_str()), Some("Hyper Ball"));
        assert_eq!(names.get(50).map(|s| s.as_str()), Some("Super Bonbon"));
    }

    fn game_root() -> Option<PathBuf> {
        let candidates = [
            PathBuf::from(r"C:\Users\lamou\AppData\Local\PNW Launcher\Game"),
            PathBuf::from(r"C:\Program Files\PNW Launcher\Game"),
        ];
        candidates.into_iter().find(|r| r.join("Data").join("2.dat").is_file())
    }

    #[test]
    fn parse_zone_names_if_game_installed() {
        let root = match game_root() {
            Some(r) => r,
            None => return,
        };
        let zones = read_french_zone_names(&root).expect("zone names");
        assert!(zones.len() > 100, "trop peu de zones: {}", zones.len());
        assert_eq!(zones.get(3).map(|s| s.as_str()), Some("Route 1"));
        assert_eq!(zones.get(7).map(|s| s.as_str()), Some("Argenta"));
    }

    #[test]
    fn parse_map_to_zone_if_game_installed() {
        let root = match game_root() {
            Some(r) => r,
            None => return,
        };
        let map_to_panel = read_map_to_zone(&root).expect("map_to_zone");
        assert!(!map_to_panel.is_empty());
        // map_id 50 should have panel_id 3 (Route 1)
        assert_eq!(map_to_panel.get(&50), Some(&3));

        let zones = read_french_zone_names(&root).expect("zone names");
        let panel = map_to_panel[&50] as usize;
        assert_eq!(zones.get(panel).map(|s| s.as_str()), Some("Route 1"));
    }
}
