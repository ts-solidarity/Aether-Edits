import React from "react";
import "./App.css";
import ErrorBoundary from "./components/ErrorBoundary";
import HomePage from "./pages/HomePage";

function App() {
  return (
    <ErrorBoundary>
      <HomePage />
    </ErrorBoundary>
  );
}

export default App;
