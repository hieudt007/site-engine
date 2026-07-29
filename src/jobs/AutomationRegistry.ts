export type AutomationFunction = () => Promise<string | void>;

export const AutomationRegistry: Record<string, AutomationFunction> = {
  "test_function": async () => {
    console.log("[AutomationRegistry] test_function is executing...");
    return "Test function executed successfully at " + new Date().toISOString();
  },
  // Add other system functions here
};
