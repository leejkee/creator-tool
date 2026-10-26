//! Temporary real-data exercise of creator-document-core, not a production migrator.
use creator_document_core::{DOCUMENT_VERSION, DocumentStore, ImageDocument, Node};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashSet},
    error::Error,
    fs,
    path::Path,
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
fn core<T>(result: creator_document_core::Result<T>) -> Result<T> {
    result.map_err(|error| format!("{}: {}", error.code, error.message).into())
}

/// Only the row/column layouts actually used by this acceptance document are migrated.
fn convert_node(value: &Value) -> Result<Value> {
    let mut node = value
        .as_object()
        .ok_or("Expected legacy node object")?
        .clone();
    let id = node
        .get("id")
        .and_then(Value::as_str)
        .ok_or("Missing legacy id")?
        .to_owned();
    let kind = node
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("group")
        .to_owned();
    let title = node.remove("title");
    let title_style = node.remove("titleStyle");
    let mut children = Vec::new();
    let mode;
    if kind == "itemRow" {
        node.insert("type".into(), json!("group"));
        let mut image = node
            .remove("image")
            .and_then(|v| v.as_object().cloned())
            .ok_or("Missing itemRow image")?;
        let text = node.remove("text").unwrap_or(json!(""));
        let overrides = node
            .remove("textOverrides")
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        let mut style = node
            .get("style")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        image.insert("id".into(), json!(format!("{id}:image")));
        image.insert("type".into(), json!("image"));
        image
            .entry("width")
            .or_insert(style.get("imageWidth").cloned().unwrap_or(json!(110)));
        let default_height = style
            .get("imageHeight")
            .cloned()
            .unwrap_or_else(|| image["width"].clone());
        image.entry("height").or_insert(default_height);
        let mut text_style = style.clone();
        for key in [
            "background",
            "radius",
            "padding",
            "gap",
            "imageWidth",
            "imageHeight",
        ] {
            text_style.remove(key);
        }
        if let Some(extra) = overrides.get("style").and_then(Value::as_object) {
            text_style.extend(extra.clone());
        }
        let mut text_node = overrides;
        text_node.insert("id".into(), json!(format!("{id}:text")));
        text_node.insert("type".into(), json!("text"));
        text_node.insert("text".into(), text);
        text_node.insert("style".into(), Value::Object(text_style));
        node.insert(
            "padding".into(),
            style.remove("padding").unwrap_or(json!(14)),
        );
        node.insert("gap".into(), style.remove("gap").unwrap_or(json!(20)));
        style.remove("imageWidth");
        style.remove("imageHeight");
        node.insert("style".into(), Value::Object(style));
        children.push(Value::Object(image));
        children.push(Value::Object(text_node));
        mode = "row".to_owned();
    } else if kind == "group" {
        node.insert("type".into(), json!("group"));
        let legacy_layout = node
            .remove("layout")
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        mode = legacy_layout
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("column")
            .to_owned();
        for (key, value) in legacy_layout {
            if key != "type" {
                node.insert(key, value);
            }
        }
        if let Some(Value::String(title)) = title {
            node.entry("name").or_insert(json!(title));
            let mut style = json!({"fontSize":36,"bold":true,"color":"#C2A0FF"})
                .as_object()
                .unwrap()
                .clone();
            if let Some(extra) = title_style.and_then(|v| v.as_object().cloned()) {
                style.extend(extra);
            }
            children
                .push(json!({"id":format!("{id}:title"),"type":"text","text":title,"style":style}));
        }
        let elements = node.remove("elements").unwrap_or(json!([]));
        for child in elements
            .as_array()
            .ok_or("Legacy elements must be an array")?
        {
            children.push(convert_node(child)?);
        }
    } else {
        // This specific file has no legacy leaf title fields.
        if let Some(title) = title {
            node.insert("title".into(), title);
        }
        if let Some(style) = title_style {
            node.insert("titleStyle".into(), style);
        }
        return Ok(Value::Object(node));
    }
    if !matches!(mode.as_str(), "row" | "column") {
        return Err(format!("Unhandled legacy layout: {mode}").into());
    }
    let count = u32::try_from(children.len())?.max(1);
    let layout = if mode == "row" {
        (1, count)
    } else {
        (count, 1)
    };
    let placements: Vec<Value> = children
        .into_iter()
        .enumerate()
        .map(|(index, module)| {
            let index = u32::try_from(index).unwrap();
            let position = if mode == "row" {
                (0, index)
            } else {
                (index, 0)
            };
            json!({"position":position,"module":module})
        })
        .collect();
    node.remove("elements");
    node.remove("position");
    node.insert("layout".into(), json!(layout));
    node.insert("children".into(), json!(placements));
    Ok(Value::Object(node))
}

fn legacy_content(node: &Value, ids: &mut HashSet<String>, text: &mut BTreeMap<String, usize>) {
    if let Some(id) = node.get("id").and_then(Value::as_str) {
        ids.insert(id.into());
    }
    for key in ["text", "title"] {
        if let Some(value) = node
            .get(key)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            *text.entry(value.into()).or_default() += 1;
        }
    }
    if let Some(children) = node.get("elements").and_then(Value::as_array) {
        for child in children {
            legacy_content(child, ids, text);
        }
    }
}
fn inspect_node(
    node: &Node,
    ids: &mut HashSet<String>,
    text: &mut BTreeMap<String, usize>,
    assets: &mut Vec<String>,
    depth: u32,
) -> (usize, u32) {
    ids.insert(node.id.clone());
    if let Some(value) = node
        .properties
        .get("text")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        *text.entry(value.into()).or_default() += 1;
    }
    if node.kind == "image" {
        if let Some(asset) = node.properties.get("assetId").and_then(Value::as_str) {
            assets.push(asset.into());
        }
    }
    let mut count = 1;
    let mut max_depth = depth;
    for placed in &node.children {
        let (n, d) = inspect_node(&placed.module, ids, text, assets, depth + 1);
        count += n;
        max_depth = max_depth.max(d);
    }
    (count, max_depth)
}

fn main() -> Result<()> {
    let repository = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let source = repository.join("tool_test/pjt.json");
    let output = std::env::temp_dir().join(format!("creator-miyue-demo-{}", std::process::id()));
    fs::create_dir_all(&output)?;
    let source_bytes = fs::read(&source)?;
    let legacy: Value = serde_json::from_slice(&source_bytes)?;
    let old_error =
        ImageDocument::parse(&source_bytes).expect_err("Old format must not be silently accepted");
    println!("旧 JSON 直接读取: {}（符合预期）", old_error.code);
    let mut old_ids = HashSet::new();
    let mut old_text = BTreeMap::new();
    for module in legacy["modules"]
        .as_array()
        .ok_or("Missing legacy modules")?
    {
        legacy_content(module, &mut old_ids, &mut old_text);
    }
    let mut converted = legacy
        .as_object()
        .ok_or("Expected document object")?
        .clone();
    converted.insert("image-create-tool-version".into(), json!(DOCUMENT_VERSION));
    let modules: Vec<Value> = legacy["modules"]
        .as_array()
        .unwrap()
        .iter()
        .map(convert_node)
        .collect::<Result<_>>()?;
    converted.insert("modules".into(), json!(modules));
    let assets = source
        .parent()
        .unwrap()
        .join(legacy["assetsDir"].as_str().unwrap_or("assets/"))
        .canonicalize()?;
    converted.insert("assetsDir".into(), json!(assets));

    // Construct an actual ImageDocument using the production business crate.
    let document = core(ImageDocument::from_value(Value::Object(converted)))?;
    assert_eq!(document.properties["sourceNotes"], legacy["sourceNotes"]);
    let mut ids = HashSet::new();
    let mut text = BTreeMap::new();
    let mut references = Vec::new();
    let mut count = 0;
    let mut depth = 0;
    for node in &document.modules {
        let (n, d) = inspect_node(node, &mut ids, &mut text, &mut references, 1);
        count += n;
        depth = depth.max(d);
    }
    assert!(old_ids.is_subset(&ids), "An original stable ID was lost");
    for (content, occurrences) in &old_text {
        assert!(
            text.get(content).copied().unwrap_or(0) >= *occurrences,
            "Original text was lost: {content}"
        );
    }
    for asset in &references {
        let content = fs::read(assets.join(asset))?;
        assert!(!content.is_empty(), "Empty image asset: {asset}");
    }
    let bytes = core(document.encode())?;
    let template_path = output.join("miyue-v0.2.image.json");
    fs::write(&template_path, &bytes)?;
    let reparsed = core(ImageDocument::parse(&fs::read(&template_path)?))?;
    assert_eq!(
        document, reparsed,
        "Serialized round-trip changed the object"
    );
    println!(
        "ImageDocument 构造成功: title={}，顶层模块={}，全部节点={}，最大深度={}",
        document.properties["title"],
        document.modules.len(),
        count,
        depth
    );
    println!(
        "内容核对通过: {} 个原有 ID、{} 段原文、sourceNotes 完整；{} 个素材引用可读取",
        old_ids.len(),
        old_text.len(),
        references.len()
    );
    println!("转换 JSON: {}", template_path.display());

    // Also exercise template creation, the session model and the real filesystem API.
    let workspace = output.join(format!("workspace-{}", std::process::id()));
    fs::create_dir_all(&workspace)?;
    let mut store = DocumentStore::default();
    let created = core(store.create(Some(&workspace), None, "芈月攻略", Some(&template_path)))?;
    assert_eq!(created.document.modules, document.modules);
    assert_eq!(
        created.document.properties["sourceNotes"],
        legacy["sourceNotes"]
    );
    assert_ne!(created.document.document_id, document.document_id);
    assert_eq!(created.document.revision, 0);
    assert!(!created.dirty);
    let reopened = core(DocumentStore::default().open(&created.path))?;
    assert_eq!(reopened.document, created.document);
    println!(
        "业务会话创建及重新打开成功: sessionId={}，dirty={}，revision={}",
        created.session_id, created.dirty, created.document.revision
    );
    println!("新模块 JSON: {}", created.path.display());
    assert_eq!(
        fs::read(&source)?,
        source_bytes,
        "Original repository JSON changed"
    );
    println!("仓库原始芈月 JSON 未修改；未执行渲染。");
    Ok(())
}
