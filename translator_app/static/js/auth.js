const ACCESS_TOKEN_KEY = "access_token";
const REFRESH_TOKEN_KEY = "refresh_token";

function setError(message) {
    const errorElement = document.getElementById("loginError");
    if (errorElement) {
        errorElement.textContent = message;
    }
}

function setLoading(isLoading) {
    const button = document.getElementById("loginButton");
    if (!button) {
        return;
    }

    button.disabled = isLoading;
    button.querySelector("span").textContent = isLoading ? "Signing in..." : "Login";
}

async function login(username, password) {
    const response = await fetch("/api/token/", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.detail || "Invalid username or password.");
    }

    localStorage.setItem(ACCESS_TOKEN_KEY, data.access);
    localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh);
}

document.addEventListener("DOMContentLoaded", () => {
    if (localStorage.getItem(ACCESS_TOKEN_KEY)) {
        window.location.href = "/";
        return;
    }

    const form = document.getElementById("loginForm");
    const username = document.getElementById("username");
    const password = document.getElementById("password");

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        setError("");

        const usernameValue = username.value.trim();
        const passwordValue = password.value;

        if (!usernameValue || !passwordValue) {
            setError("Please enter both username and password.");
            return;
        }

        setLoading(true);

        try {
            await login(usernameValue, passwordValue);
            window.location.href = "/";
        } catch (error) {
            setError(error.message);
        } finally {
            setLoading(false);
        }
    });
});
