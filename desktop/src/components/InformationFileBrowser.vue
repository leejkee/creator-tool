<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import type {
  DirectoryListing,
  FileBrowserPort,
  PathRequest,
} from "../editor/contracts";
const props = defineProps<{
  request: PathRequest;
  browser: FileBrowserPort;
  blocked?: boolean;
}>();
const emit = defineEmits<{ select: [path: string]; cancel: [] }>();
const listing = shallowRef<DirectoryListing>();
const address = ref(props.request.initial ?? "");
const filename = ref(props.request.kind === "saveAs" ? "图片.json" : "");
const search = ref("");
const error = ref("");
const busy = ref(false);
let generation = 0;
const heading = computed(
  () =>
    ({
      directory: "选择工作目录",
      image: "选择本地图片",
      json: "选择 JSON 模板",
      saveAs: "文档另存为",
    })[props.request.kind],
);
const entries = computed(
  () =>
    listing.value?.entries.filter((entry) =>
      entry.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()),
    ) ?? [],
);
const describe = (value: unknown) =>
  value && typeof value === "object" && "message" in value
    ? String(value.message)
    : String(value);
async function browse(path?: string): Promise<boolean> {
  if (props.blocked) {
    return false;
  }
  const request = ++generation;
  busy.value = true;
  error.value = "";
  try {
    const next = await props.browser.browse(
      props.request.kind,
      path || undefined,
    );
    if (request !== generation) {
      return false;
    }
    listing.value = next;
    address.value = next.directory;
    search.value = "";
    if (props.request.kind !== "saveAs") {
      filename.value = "";
    }
    return true;
  } catch (value) {
    if (request === generation) {
      error.value = describe(value);
    }
    return false;
  } finally {
    if (request === generation) {
      busy.value = false;
    }
  }
}
async function select(): Promise<void> {
  if (busy.value || props.blocked) {
    return;
  }
  const chosenName = filename.value;
  if (
    (!listing.value || address.value !== listing.value.directory) &&
    !(await browse(address.value))
  ) {
    return;
  }
  filename.value = chosenName;
  const request = ++generation;
  busy.value = true;
  error.value = "";
  try {
    const path = await props.browser.resolve(
      props.request.kind,
      listing.value!.directory,
      filename.value,
    );
    if (request === generation) {
      if (props.blocked) {
        error.value = "文档正在保存，请完成后再确认所选路径";
      } else {
        emit("select", path);
      }
    }
  } catch (value) {
    if (request === generation) {
      error.value = describe(value);
    }
  } finally {
    if (request === generation) {
      busy.value = false;
    }
  }
}
onMounted(() => {
  void browse(props.request.initial);
});
onBeforeUnmount(() => {
  generation++;
});
</script>

<template>
  <section class="information-task" aria-label="文件与目录选择">
    <header class="information-heading">
      <h2>{{ heading }}</h2>
      <button type="button" @click="emit('cancel')">取消</button>
    </header>
    <form class="path-address" @submit.prevent="browse(address)">
      <label for="browse-address">目录</label
      ><input
        id="browse-address"
        v-model="address"
        :disabled="busy || blocked"
        placeholder="输入完整目录路径"
        autocomplete="off"
      /><button type="submit" :disabled="busy || blocked">前往</button
      ><button
        type="button"
        :disabled="busy || blocked || !listing?.parent"
        @click="browse(listing?.parent)"
      >
        上一级
      </button>
    </form>
    <div class="path-locations">
      <button
        v-for="root in listing?.roots"
        :key="root.path"
        type="button"
        :disabled="busy || blocked"
        :data-hint="root.path"
        @click="browse(root.path)"
      >
        {{ root.label }}</button
      ><button
        v-if="request.initial"
        type="button"
        :disabled="busy || blocked"
        :data-hint="request.initial"
        @click="browse(request.initial)"
      >
        起始目录</button
      ><input
        v-model="search"
        aria-label="筛选当前目录"
        placeholder="筛选当前目录"
        :disabled="busy || blocked"
        autocomplete="off"
      />
    </div>
    <p v-if="busy" class="muted" role="status">正在读取…</p>
    <div class="path-entries" :aria-busy="busy">
      <button
        v-for="entry in entries"
        :key="entry.path"
        type="button"
        :disabled="busy || blocked"
        :class="{ selected: !entry.directory && filename === entry.name }"
        :data-hint="entry.path"
        @click="entry.directory ? browse(entry.path) : (filename = entry.name)"
        @dblclick="!entry.directory && select()"
      >
        <span>{{ entry.directory ? "▱" : "▤" }}</span
        >{{ entry.name }}<small v-if="entry.directory">打开目录</small>
      </button>
      <p v-if="listing && !entries.length && !busy" class="muted">
        {{ search ? "没有匹配的目录或文件。" : "当前目录没有可选条目。" }}
      </p>
    </div>
    <form class="path-submit" @submit.prevent="select">
      <template v-if="request.kind !== 'directory'"
        ><label for="browse-filename">{{
          request.kind === "saveAs" ? "文件名" : "文件名或完整路径"
        }}</label
        ><input
          id="browse-filename"
          v-model="filename"
          :disabled="busy || blocked"
          autocomplete="off" /></template
      ><span v-else class="path-current"
        >当前目录：{{ listing?.directory || address }}</span
      ><button
        type="submit"
        class="primary"
        :disabled="busy || blocked || (!listing && !address)"
      >
        {{
          request.kind === "directory"
            ? "使用当前目录"
            : request.kind === "saveAs"
              ? "使用此路径另存为"
              : "使用所选文件"
        }}
      </button>
    </form>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <p v-for="warning in listing?.warnings" :key="warning" class="field-hint">
      {{ warning }}
    </p>
  </section>
</template>
