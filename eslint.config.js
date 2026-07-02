import js from "@eslint/js";
import globals from "globals";

export default [
    js.configs.recommended,

    {
        files: ["**/*.js"],

        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",

            globals: {
                ...globals.browser,

                // Foundry core globals
                game: "readonly",
                ui: "readonly",
                Hooks: "readonly",
                CONFIG: "readonly",
                foundry: "readonly",

                // Canvas / rendering
                canvas: "readonly",
                PIXI: "readonly",
				Roll: "readonly",

                // Documents
                Actor: "readonly",
                Item: "readonly",
                Scene: "readonly",
                Token: "readonly",
                ChatMessage: "readonly",

                // UI / apps
                Dialog: "readonly",
                Application: "readonly",
                FormApplication: "readonly",
                TextEditor: "readonly",

                // Utilities / constants
                CONST: "readonly",
            },
        },

        rules: {
            "no-undef": "error",
			"no-unused-vars": "off"
        },
    },
];