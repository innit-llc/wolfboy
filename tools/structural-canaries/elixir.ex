defmodule Canary.Components do
  use Phoenix.Component

  def close_button(assigns) do
    ~H"""
    <button type="button" aria-label={@label}>
      <.icon name="hero-x-mark" />
    </button>
    """
  end
end
