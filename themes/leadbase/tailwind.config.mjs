
export default {
  content: ["./**/*.liquid", "./assets/**/*.js"],
  ...{
            "theme": {
                "extend": {
                    "colors": {
                        "brand": {
                            "dark": "#0A132B",
                            "DEFAULT": "#2563eb",
                            "hover": "#1d4ed8",
                            "light": "#eff6ff",
                            "gray": "#64748B"
                        }
                    },
                    "fontFamily": {
                        "sans": ["Poppins", "sans-serif"]
                    },
                    "boxShadow": {
                        "glass": "0 8px 32px 0 rgba(37, 99, 235, 0.08)"
                    }
                }
            }
        }
};
  