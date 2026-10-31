import { computed, shallowRef } from "vue";
import type {
  Ask,
  ChooseOption,
  Decision,
  OptionRequest,
} from "../editor/contracts";

/** UI requests remain pending until the user acts in the bottom information area. */
export function useInformationArea() {
  const decision = shallowRef<Decision>();
  const options = shallowRef<OptionRequest>();
  let finishDecision: ((value: string) => void) | undefined;
  let finishOptions: ((value: string | undefined) => void) | undefined;
  const answer = (value: string): void => {
    const finish = finishDecision;
    finishDecision = undefined;
    decision.value = undefined;
    finish?.(value);
  };
  const selectOption = (value?: string): void => {
    const finish = finishOptions;
    finishOptions = undefined;
    options.value = undefined;
    finish?.(value);
  };
  const ask: Ask = (request) => {
    if (finishDecision || finishOptions) {
      return Promise.resolve("cancel");
    }
    return new Promise((resolve) => {
      decision.value = request;
      finishDecision = resolve;
    });
  };
  const chooseOption: ChooseOption = (request) => {
    if (finishDecision || finishOptions) {
      return Promise.resolve(undefined);
    }
    return new Promise((resolve) => {
      options.value = request;
      finishOptions = resolve;
    });
  };
  const pending = computed(() => !!decision.value || !!options.value);
  const cancel = (): void => {
    if (options.value) {
      selectOption();
    } else if (decision.value) {
      answer("cancel");
    }
  };
  return {
    decision,
    options,
    pending,
    ask,
    chooseOption,
    answer,
    selectOption,
    cancel,
  };
}
