//! Ordered TS processing declarations. Rust stores them without business validation.
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
                formatter.write_str("[string function identifier, ...arguments]")
            }

            fn visit_seq<A: de::SeqAccess<'de>>(
                self,
                mut sequence: A,
            ) -> Result<Self::Value, A::Error> {
                let function_id: String = sequence
                    .next_element()?
                    .ok_or_else(|| de::Error::invalid_length(0, &self))?;
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
