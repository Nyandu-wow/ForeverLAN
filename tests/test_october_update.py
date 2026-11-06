"""October tuning compatibility: measured travel and racial buffs stay distinct."""
import unittest
from lua_harness import boot


class OctoberUpdateTests(unittest.TestCase):
    def test_faster_movement_is_measured_without_racial_multipliers(self):
        for multiplier in (1.6, 1.3):
            with self.subTest(multiplier=multiplier):
                lua, env = boot()
                lua.execute('''
mockPosition = 0
function UnitPosition() return mockPosition, 0, 0, 1 end
''')
                env.sampleTravelDistance()
                # Ten seconds at normal running speed, increased by a client buff.
                for sample in range(1, 21):
                    lua.globals().mockPosition = sample * 0.5 * 7 * multiplier
                    lua.globals().clock += 0.5
                    distance, method = env.sampleTravelDistance()
                self.assertAlmostEqual(distance, 10 * 7 * multiplier)
                self.assertEqual(method, 'UnitPosition')

    def test_skyborne_world_buffs_are_not_food(self):
        lua, env = boot()
        lua.execute('''
function UnitBuff(unit, index)
  if index == 1 then return "Attuned", nil, 1, nil, 3600, clock+3600 end
  if index == 2 then return "Charged", nil, 1, nil, 3600, clock+3600 end
end
''')
        buff, method = env.readFoodBuff()
        self.assertIsNone(buff)
        self.assertEqual(method, 'none')
        lua.execute('''
local racialBuff = UnitBuff
function UnitBuff(unit, index)
  if index == 3 then return "Well Fed", nil, 1, nil, 900, clock+900 end
  return racialBuff(unit, index)
end
''')
        buff, method = env.readFoodBuff()
        self.assertEqual(buff.name, 'Well Fed')
        self.assertEqual(buff.remaining_seconds, 900)
        self.assertEqual(method, 'UnitBuff')
