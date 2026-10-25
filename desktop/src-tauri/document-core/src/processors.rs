//! Ordered TS processing declarations. Rust stores and validates them; it does not run scripts.
use crate::validation::{ValidationIssue, Violation, child, issue};
use serde::{Deserialize, Deserializer, Serialize, Serializer, de, ser::SerializeSeq};
use serde_json::Value;
use std::fmt;

/// Wire format: [function_id, ...args]. The image is supplied by the Engine.
#[derive(Debug, Clone, PartialEq)]
pub struct ImageProcessor {
    pub function_id: String,
    pub args: Vec<Value>,
}

impl Serialize for ImageProcessor {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut sequence = serializer.serialize_seq(Some(self.args.len() + 1))?;
        sequence.serialize_element(&self.function_id)?;
        for argument in &self.args {
            sequence.serialize_element(argument)?;
        }
        sequence.end()
    }
}

impl<'de> Deserialize<'de> for ImageProcessor {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ProcessorVisitor;
        impl<'de> de::Visitor<'de> for ProcessorVisitor {
            type Value = ImageProcessor;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("[nonempty function identifier, ...arguments]")
            }

            fn visit_seq<A: de::SeqAccess<'de>>(
                self,
                mut sequence: A,
            ) -> Result<Self::Value, A::Error> {
                let function_id: String = sequence
                    .next_element()?
                    .ok_or_else(|| de::Error::invalid_length(0, &self))?;
                if function_id.trim().is_empty() {
                    return Err(de::Error::custom("Function identifier must not be empty"));
                }
                let mut args = Vec::new();
                while let Some(argument) = sequence.next_element()? {
                    args.push(argument);
                }
                Ok(ImageProcessor { function_id, args })
            }
        }
        deserializer.deserialize_seq(ProcessorVisitor)
    }
}

pub(crate) fn validate_processors(
    value: &Value,
    path: &str,
    is_image: bool,
) -> Vec<ValidationIssue> {
    let Some(processors) = value.as_array() else {
        return vec![issue(
            "INVALID_PROCESSORS",
            Violation::InvalidType,
            path,
            "Expected an ordered processors array",
        )];
    };
    let mut issues = Vec::new();
    if !is_image && !processors.is_empty() {
        issues.push(issue(
            "INVALID_PROCESSORS",
            Violation::UnsupportedField,
            path,
            "Only image modules support image processing",
        ));
    }
    for (index, processor) in processors.iter().enumerate() {
        let path = child(path, &index.to_string());
        let Some(call) = processor.as_array() else {
            issues.push(issue(
                "INVALID_PROCESSORS",
                Violation::InvalidType,
                &path,
                "Expected [function identifier, ...arguments]",
            ));
            continue;
        };
        let function_path = child(&path, "0");
        let (rule, message) = match call.first() {
            None => (Violation::MissingField, "Function identifier is required"),
            Some(Value::String(id)) if id.trim().is_empty() => (
                Violation::EmptyValue,
                "Function identifier must not be empty",
            ),
            Some(Value::String(_)) => continue,
            Some(Value::Null) => (
                Violation::NullNotAllowed,
                "Function identifier cannot be null",
            ),
            Some(_) => (
                Violation::InvalidType,
                "Function identifier must be a string",
            ),
        };
        issues.push(issue("INVALID_PROCESSORS", rule, &function_path, message));
    }
    issues
}
