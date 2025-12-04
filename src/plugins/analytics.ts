// Local plugin
const analyticsPlugin = {
  name: "analytics",
  async install(app, { context }) {
    console.log("Installing analytics plugin...");
    context.on("track", (data) => console.log("Tracking:", data));
  },
  onInit() {
    console.log("Analytics plugin initialized.");
  },
};
