
export default {
  content: ["./**/*.liquid", "./assets/**/*.js"],
  ...{
            "theme": {
                "extend": {
                    "colors": {
                        "brand": {
                            "dark": "#1b5e20",
                            "DEFAULT": "#43a047",
                            "hover": "#2e7d32",
                            "light": "#e8f5e9",
                            "gray": "#64748B"
                        },
                        "blue": {
                            "50": "#e8f5e9",
                            "100": "#c8e6c9",
                            "200": "#a5d6a7",
                            "300": "#81c784",
                            "400": "#66bb6a",
                            "500": "#4caf50",
                            "600": "#43a047",
                            "700": "#388e3c",
                            "800": "#2e7d32",
                            "900": "#1b5e20"
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
  