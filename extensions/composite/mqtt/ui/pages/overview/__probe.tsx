import { mount, signal, Text, View } from "nsh";

function App() {
  const data = signal<string | null>(null);
  const ticks = signal(0);
  setTimeout(() => data.set("loaded"), 100);

  function body() {
    return (
      <View style={{ display: "flex", flexDirection: "column" }}>
        <Text>{`body-${data()}-${ticks()}`}</Text>
        <View onPress={() => ticks.set(ticks() + 1)}>
          <Text>add</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <If when={data() === null} else={body()}>
        <Text>loading-state</Text>
      </If>
    </View>
  );
}

mount(App);
