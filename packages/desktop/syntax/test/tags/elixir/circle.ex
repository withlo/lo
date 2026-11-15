defmodule Shapes.Circle do
  @moduledoc "A round shape."

  alias Shapes.Shape
  import Shapes.Units, only: [to_metres: 2]

  @max_radius 100

  defstruct radius: 1.0

  @behaviour Shape

  @impl Shape
  def area(%__MODULE__{radius: radius}) do
    squared = radius * radius
    :math.pi() * to_metres(squared, :metre)
  end

  def new(radius) when is_number(radius), do: %__MODULE__{radius: min(radius, @max_radius)}

  defp describe(circle), do: "circle of #{circle.radius}"

  defmacro unit, do: quote(do: Shapes.Circle.new(1))
end

defprotocol Shapes.Area do
  def area(shape)
end
